import { HttpError, tx, type Pool } from "@ultimyr/service-kit";
import { DEFAULT_ICON, bestIcon, contentTypesFor, hasIcon, inferTopics, normalizeTags, suggestIcons, type IconSuggestion } from "@ultimyr/tagging";

export const TARGET_KINDS = ["archive", "stage", "step", "resource", "item", "objective"] as const;
export type TargetKind = (typeof TARGET_KINDS)[number];
/** The things that carry an icon. */
export const ICON_KINDS = ["archive", "stage", "step"] as const;
export type IconKind = (typeof ICON_KINDS)[number];

type Row = Record<string, any>;

interface TNode {
  kind: TargetKind;
  id: string;
  title: string;
  /** Text read for inferred topics. */
  text: string;
  parent: TNode | null;
  /** Tags a person (or assistant) set. */
  explicit: string[];
  /** Content types implied by what the thing is (a video link, a flashcard deck) plus the tags of what it points at. */
  derived: string[];
  icon: { name: string | null; source: string } | null;
}

export interface TaggedTarget {
  kind: TargetKind;
  id: string;
  title: string;
  /** Set by hand. */
  tags: string[];
  /** Implied by the type of material. */
  derived: string[];
  /** Read from the title, summary and linked exam objectives. Never stored. */
  inferred: Array<{ tag: string; hits: number }>;
  icon?: { name: string | null; source: string };
}

const uniq = <T>(a: T[]) => [...new Set(a)];

export interface Model {
  archive: TNode;
  nodes: TNode[];
  byKey: Map<string, TNode>;
}
export const keyOf = (kind: string, id: string) => `${kind}:${id}`;

/** Everything taggable in one archive, with its parents. `editor` includes drafts. */
export async function loadModel(pool: Pool, archive: Row, editor: boolean): Promise<Model> {
  const aid = archive.id as string;
  const [stages, steps, resources, items, objectives, links, objLinks] = await Promise.all([
    pool.query("SELECT id, title, summary, icon_name, icon_source FROM content.roadmap_stages WHERE master_item_id = $1 ORDER BY ord", [aid]),
    pool.query(
      `SELECT st.id, st.stage_id, st.parent_id, st.kind, st.title, st.note, st.item_id, st.resource_id, st.icon_name, st.icon_source
         FROM content.roadmap_steps st JOIN content.roadmap_stages sg ON sg.id = st.stage_id
        WHERE st.master_item_id = $1 ORDER BY sg.ord, st.ord`,
      [aid],
    ),
    pool.query("SELECT id, kind, title, summary, tags, status FROM content.resources WHERE master_item_id = $1 AND deleted_at IS NULL ORDER BY ord, created_at", [aid]),
    pool.query("SELECT id, kind, title, summary, status FROM content.sub_items WHERE master_item_id = $1 AND deleted_at IS NULL ORDER BY created_at", [aid]),
    pool.query("SELECT id, title, summary FROM content.objectives WHERE archive_id = $1 ORDER BY ord, code", [aid]),
    pool.query("SELECT target_kind, target_id, tag FROM content.tag_links WHERE archive_id = $1", [aid]),
    pool.query("SELECT kind, ref_id, objective_id FROM content.objective_links WHERE archive_id = $1", [aid]),
  ]);

  const stored = new Map<string, string[]>();
  for (const l of links.rows) (stored.get(keyOf(l.target_kind, l.target_id)) ?? stored.set(keyOf(l.target_kind, l.target_id), []).get(keyOf(l.target_kind, l.target_id))!).push(l.tag);
  const explicitFor = (kind: TargetKind, id: string, legacy: string[] = []) => normalizeTags([...(stored.get(keyOf(kind, id)) ?? []), ...legacy]);

  const root: TNode = {
    kind: "archive",
    id: aid,
    title: archive.title,
    text: `${archive.title}. ${String(archive.overview ?? "").slice(0, 600)}`,
    parent: null,
    explicit: explicitFor("archive", aid, archive.tags ?? []),
    derived: [],
    icon: { name: archive.icon_name, source: archive.icon_source },
  };
  const nodes: TNode[] = [root];
  const byKey = new Map<string, TNode>([[keyOf("archive", aid), root]]);
  const add = (n: TNode) => {
    nodes.push(n);
    byKey.set(keyOf(n.kind, n.id), n);
    return n;
  };

  const visible = (s: Row) => editor || s.status === "published";
  const resById = new Map<string, Row>(resources.rows.filter(visible).map((r) => [r.id, r]));
  const itemById = new Map<string, Row>(items.rows.filter(visible).map((r) => [r.id, r]));
  const objById = new Map<string, Row>(objectives.rows.map((o) => [o.id, o]));
  const objText = new Map<string, string[]>();
  for (const l of objLinks.rows) {
    const o = objById.get(l.objective_id);
    if (o) (objText.get(keyOf(l.kind, l.ref_id)) ?? objText.set(keyOf(l.kind, l.ref_id), []).get(keyOf(l.kind, l.ref_id))!).push(`${o.title} ${o.summary}`);
  }

  for (const r of resById.values()) {
    add({ kind: "resource", id: r.id, title: r.title, text: `${r.title}. ${r.summary} ${(objText.get(keyOf("resource", r.id)) ?? []).join(" ")}`, parent: root, explicit: explicitFor("resource", r.id, r.tags), derived: contentTypesFor({ resourceKind: r.kind }), icon: null });
  }
  for (const s of itemById.values()) {
    add({ kind: "item", id: s.id, title: s.title, text: `${s.title}. ${s.summary} ${(objText.get(keyOf("item", s.id)) ?? []).join(" ")}`, parent: root, explicit: explicitFor("item", s.id), derived: contentTypesFor({ itemKind: s.kind }), icon: null });
  }
  for (const o of objectives.rows) {
    add({ kind: "objective", id: o.id, title: o.title, text: `${o.title}. ${o.summary}`, parent: root, explicit: explicitFor("objective", o.id), derived: [], icon: null });
  }
  const stageNodes = new Map<string, TNode>();
  for (const sg of stages.rows) {
    stageNodes.set(sg.id, add({ kind: "stage", id: sg.id, title: sg.title, text: `${sg.title}. ${sg.summary}`, parent: root, explicit: explicitFor("stage", sg.id), derived: [], icon: { name: sg.icon_name, source: sg.icon_source } }));
  }
  const stepNodes = new Map<string, TNode>();
  // Parents are listed before children (rows are written parent first), but resolve in a second pass to be safe.
  for (const st of steps.rows) {
    const res = st.resource_id ? resById.get(st.resource_id) : undefined;
    const item = st.item_id ? itemById.get(st.item_id) : undefined;
    if ((st.resource_id && !res) || (st.item_id && !item)) continue; // hidden from this reader
    const target = res ? byKey.get(keyOf("resource", res.id))! : item ? byKey.get(keyOf("item", item.id))! : null;
    const own = st.kind === "milestone" ? st.title : (target?.title ?? "");
    stepNodes.set(
      st.id,
      add({
        kind: "step",
        id: st.id,
        title: own,
        text: `${own}. ${target ? target.text.slice(own.length + 1) : ""} ${st.note ?? ""}`,
        parent: null,
        explicit: explicitFor("step", st.id),
        derived: uniq([...(target?.derived ?? []), ...(target?.explicit.filter((t) => t.startsWith("content-type:")) ?? [])]),
        icon: { name: st.icon_name, source: st.icon_source },
      }),
    );
  }
  for (const st of steps.rows) {
    const n = stepNodes.get(st.id);
    if (!n) continue;
    n.parent = (st.parent_id ? stepNodes.get(st.parent_id) : undefined) ?? stageNodes.get(st.stage_id) ?? root;
  }
  return { archive: root, nodes, byKey };
}

const inferredOf = (n: TNode) => {
  const have = new Set(n.explicit);
  return inferTopics(n.text).filter((t) => !have.has(t.tag));
};

export function describeTargets(model: Model, filter: { kind?: TargetKind; tag?: string } = {}): TaggedTarget[] {
  return model.nodes
    .filter((n) => !filter.kind || n.kind === filter.kind)
    .map((n) => ({ kind: n.kind, id: n.id, title: n.title, tags: n.explicit, derived: n.derived.filter((t) => !n.explicit.includes(t)), inferred: inferredOf(n), ...(n.icon ? { icon: { name: n.icon.name, source: n.icon.source } } : {}) }))
    .filter((t) => !filter.tag || t.tags.includes(filter.tag) || t.derived.includes(filter.tag));
}

/** How many things carry each tag in this archive, counting set and implied tags. */
export function tagSummary(targets: TaggedTarget[]): Array<{ tag: string; count: number }> {
  const counts = new Map<string, number>();
  for (const t of targets) for (const tag of new Set([...t.tags, ...t.derived])) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/**
 * The tags used to pick an icon for a node, with weights: its own set tags count fully, implied content types a little
 * less, tags read from text less again, and each level up (step to stage to archive) halves everything it passes down.
 */
export function weightedTags(n: TNode): Array<{ tag: string; weight: number }> {
  const out = new Map<string, number>();
  const put = (tag: string, w: number) => out.set(tag, Math.max(out.get(tag) ?? 0, w));
  let factor = 1;
  for (let cur: TNode | null = n; cur; cur = cur.parent, factor /= 2) {
    for (const t of cur.explicit) put(t, factor);
    for (const t of cur.derived) put(t, factor * 0.8);
    for (const t of inferredOf(cur)) put(t.tag, factor * (t.hits > 1 ? 0.7 : 0.5));
  }
  return [...out].map(([tag, weight]) => ({ tag, weight }));
}

export function suggestionsFor(model: Model, kind: string, id: string, limit = 8): { target: TaggedTarget; used: Array<{ tag: string; weight: number }>; suggestions: IconSuggestion[] } {
  const n = model.byKey.get(keyOf(kind, id));
  if (!n) throw new HttpError(404, "not_found");
  const used = weightedTags(n);
  return { target: describeTargets({ ...model, nodes: [n] })[0]!, used, suggestions: suggestIcons(used, { limit }) };
}

export interface IconChange {
  kind: IconKind;
  id: string;
  title: string;
  from: string | null;
  to: string | null;
  because: string[];
}

/**
 * Give every archive, stage and step that has no icon of the person's own choosing its best match. A choice made by a
 * person (`user`) is never touched. Where nothing matches well, an automatic icon is cleared so a stale pick does not stay.
 */
export async function autoAssignIcons(pool: Pool, archive: Row): Promise<IconChange[]> {
  const model = await loadModel(pool, archive, true);
  const changes: IconChange[] = [];
  const stageUpdates: Array<[string, string | null, string]> = [];
  const stepUpdates: Array<[string, string | null, string]> = [];
  let archiveUpdate: [string, string] | null = null;

  for (const n of model.nodes) {
    if (!n.icon || n.icon.source === "user") continue;
    if (n.kind === "archive" && archive.icon_kind !== "lucide") continue;
    const best = bestIcon(weightedTags(n));
    const current = n.kind === "archive" ? (n.icon.source === "auto" ? n.icon.name : null) : n.icon.name;
    const to = best?.name ?? null;
    if (to === current) continue;
    changes.push({ kind: n.kind as IconKind, id: n.id, title: n.title, from: n.icon.name, to: n.kind === "archive" ? to ?? DEFAULT_ICON : to, because: best?.matched ?? [] });
    if (n.kind === "archive") archiveUpdate = to ? [to, "auto"] : [DEFAULT_ICON, "default"];
    else (n.kind === "stage" ? stageUpdates : stepUpdates).push([n.id, to, to ? "auto" : "none"]);
  }
  if (!changes.length) return changes;
  await tx(pool, async (c) => {
    if (archiveUpdate) await c.query("UPDATE content.master_items SET icon_name = $2, icon_source = $3 WHERE id = $1", [archive.id, archiveUpdate[0], archiveUpdate[1]]);
    for (const [table, list] of [["roadmap_stages", stageUpdates], ["roadmap_steps", stepUpdates]] as const) {
      if (!list.length) continue;
      await c.query(
        `UPDATE content.${table} t SET icon_name = v.icon, icon_source = v.src
           FROM unnest($1::uuid[], $2::text[], $3::text[]) AS v(id, icon, src) WHERE t.id = v.id AND t.icon_source <> 'user'`,
        [list.map((x) => x[0]), list.map((x) => x[1]), list.map((x) => x[2])],
      );
    }
  });
  return changes;
}

/** Best effort: used after other writes, where a tagging problem must never fail the request. Returns the fresh archive row. */
export async function refreshIcons(pool: Pool, archiveId: string): Promise<Row | null> {
  try {
    const { rows } = await pool.query("SELECT * FROM content.master_items WHERE id = $1 AND deleted_at IS NULL", [archiveId]);
    if (!rows[0]) return null;
    const changes = await autoAssignIcons(pool, rows[0]);
    if (!changes.length) return rows[0];
    return (await pool.query("SELECT * FROM content.master_items WHERE id = $1", [archiveId])).rows[0] ?? rows[0];
  } catch {
    // The next write or a manual refresh will try again.
    return null;
  }
}

const TARGET_SQL: Record<TargetKind, string> = {
  archive: "SELECT id FROM content.master_items WHERE id = ANY($2::uuid[]) AND id = $1",
  stage: "SELECT id FROM content.roadmap_stages WHERE master_item_id = $1 AND id = ANY($2::uuid[])",
  step: "SELECT id FROM content.roadmap_steps WHERE master_item_id = $1 AND id = ANY($2::uuid[])",
  resource: "SELECT id FROM content.resources WHERE master_item_id = $1 AND deleted_at IS NULL AND id = ANY($2::uuid[])",
  item: "SELECT id FROM content.sub_items WHERE master_item_id = $1 AND deleted_at IS NULL AND id = ANY($2::uuid[])",
  objective: "SELECT id FROM content.objectives WHERE archive_id = $1 AND id = ANY($2::uuid[])",
};

/** Throws 400 naming every target that is not part of this archive. */
export async function assertTargets(pool: Pool, archiveId: string, targets: Array<{ kind: TargetKind; id: string }>): Promise<void> {
  const bad: string[] = [];
  for (const kind of TARGET_KINDS) {
    const ids = uniq(targets.filter((t) => t.kind === kind).map((t) => t.id));
    if (!ids.length) continue;
    const { rows } = await pool.query(TARGET_SQL[kind], [archiveId, ids]);
    const ok = new Set(rows.map((r) => r.id as string));
    for (const id of ids) if (!ok.has(id)) bad.push(`${kind} ${id}: not part of this archive`);
  }
  if (bad.length) throw new HttpError(400, "invalid_request", { issues: bad });
}

/** Set the exact tag list for each target (an empty list clears it). Returns the normalized lists that were stored. */
export async function setTags(pool: Pool, archiveId: string, targets: Array<{ kind: TargetKind; id: string; tags: string[] }>): Promise<Array<{ kind: TargetKind; id: string; tags: string[] }>> {
  await assertTargets(pool, archiveId, targets);
  const clean = targets.map((t) => ({ kind: t.kind, id: t.id, tags: normalizeTags(t.tags) }));
  await tx(pool, async (c) => {
    for (const t of clean) {
      await c.query("DELETE FROM content.tag_links WHERE target_kind = $1 AND target_id = $2", [t.kind, t.id]);
      if (t.tags.length) await c.query("INSERT INTO content.tag_links (archive_id, target_kind, target_id, tag) SELECT $1, $2, $3, unnest($4::text[]) ON CONFLICT DO NOTHING", [archiveId, t.kind, t.id, t.tags]);
    }
  });
  return clean;
}

/** A person's own icon choice (a Lucide name), or null to hand the thing back to automatic assignment. */
export async function setIcons(pool: Pool, archive: Row, targets: Array<{ kind: IconKind; id: string; icon: string | null }>): Promise<void> {
  const bad = targets.filter((t) => t.icon !== null && !hasIcon(t.icon)).map((t) => `${t.kind} ${t.id}: unknown icon "${t.icon}"`);
  if (bad.length) throw new HttpError(400, "invalid_request", { issues: bad });
  await assertTargets(pool, archive.id, targets);
  await tx(pool, async (c) => {
    for (const t of targets) {
      if (t.kind === "archive") {
        if (t.icon) await c.query("UPDATE content.master_items SET icon_name = $2, icon_kind = 'lucide', icon_asset_id = NULL, icon_source = 'user', updated_at = now() WHERE id = $1", [t.id, t.icon]);
        else await c.query("UPDATE content.master_items SET icon_name = $2, icon_kind = 'lucide', icon_asset_id = NULL, icon_source = 'default', updated_at = now() WHERE id = $1", [t.id, DEFAULT_ICON]);
      } else {
        const table = t.kind === "stage" ? "roadmap_stages" : "roadmap_steps";
        await c.query(`UPDATE content.${table} SET icon_name = $2, icon_source = $3 WHERE id = $1`, [t.id, t.icon, t.icon ? "user" : "none"]);
      }
    }
  });
}
