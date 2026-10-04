import { HttpError, idParam, parse, tx, uuidv7, type Pool } from "@ultimyr/service-kit";
import type { PoolClient } from "pg";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ARCHIVE_REL, RANK, loadArchive, need, type Actor } from "../access.js";
import type { Ctx } from "../ctx.js";
import { guessKind, isSafeHttpsUrl, normalizeUrl, providerFor } from "../links.js";
import { parseOutline, type OutlineStep } from "../outline.js";

export const RESOURCE_KINDS = ["video", "playlist", "article", "course", "docs", "practice", "book", "podcast", "other"] as const;
const MAX_STAGES = 30;
const MAX_STEPS_PER_STAGE = 60;
const MAX_STEPS = 1000;
const MAX_RESOURCES = 1500;
const source = z.enum(["human", "ai", "mcp", "import"]);
const minutes = z.number().int().min(1).max(6000);

const url = z
  .string()
  .trim()
  .max(2000)
  .refine(isSafeHttpsUrl, "must be an https link without a username or password")
  .transform(normalizeUrl);

export const resourceInput = z.object({
  url,
  title: z.string().trim().min(1).max(200),
  kind: z.enum(RESOURCE_KINDS).optional(),
  summary: z.string().max(1000).default(""),
  minutes: minutes.nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
});
export type ResourceInput = z.infer<typeof resourceInput>;
const resourcePatch = z.object({
  url: url.optional(),
  title: z.string().trim().min(1).max(200).optional(),
  kind: z.enum(RESOURCE_KINDS).optional(),
  summary: z.string().max(1000).optional(),
  minutes: minutes.nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
  status: z.enum(["draft", "published"]).optional(),
  order: z.number().int().min(0).max(100_000).optional(),
});

const MAX_DEPTH = 3;
const stepFields = {
  id: z.uuid().optional().describe("Keep a step's id to keep people's progress on it."),
  itemId: z.uuid().optional(),
  resourceId: z.uuid().optional(),
  resource: resourceInput.optional(),
  milestone: z.string().trim().min(1).max(160).optional(),
  note: z.string().max(1000).default(""),
  required: z.boolean().default(true),
  minutes: minutes.nullable().optional(),
};
const oneTarget = (s: { itemId?: string; resourceId?: string; resource?: unknown; milestone?: string }) =>
  [s.itemId, s.resourceId, s.resource, s.milestone].filter((x) => x !== undefined).length === 1;
const ONE = "give exactly one of itemId, resourceId, resource or milestone";
// Three levels, written out so the schema stays a plain (non recursive) shape for JSON Schema consumers.
const stepLeaf = z.strictObject(stepFields).refine(oneTarget, ONE); // strict: a fourth level is an error, not silently dropped
const stepMid = z.object({ ...stepFields, steps: z.array(stepLeaf).max(60).optional() }).refine(oneTarget, ONE);
const stepInput = z.object({ ...stepFields, steps: z.array(stepMid).max(60).optional() }).refine(oneTarget, ONE);
export type StepInput = z.infer<typeof stepInput>;
const stageInput = z.object({
  id: z.uuid().optional(),
  title: z.string().trim().min(1).max(160),
  summary: z.string().max(1000).default(""),
  steps: z.array(stepInput).max(MAX_STEPS_PER_STAGE),
});
export const roadmapInput = z.object({
  summary: z.string().max(2000).default(""),
  stages: z.array(stageInput).max(MAX_STAGES),
  status: z.enum(["draft", "published"]).optional(),
  source: source.default("human"),
});
export type RoadmapInput = z.infer<typeof roadmapInput>;

type Row = Record<string, any>;

export const resourceOut = (r: Row) => ({
  id: r.id,
  archiveId: r.master_item_id,
  kind: r.kind,
  title: r.title,
  url: r.url,
  provider: r.provider,
  summary: r.summary,
  minutes: r.minutes,
  tags: r.tags,
  status: r.status,
  source: r.source,
  order: r.ord,
  updatedAt: r.updated_at,
});

/** Create a resource, or update the one already stored for the same link in this archive. */
export async function upsertResource(c: PoolClient | Pool, archiveId: string, ownerId: string, input: ResourceInput, src: string, status?: "draft" | "published"): Promise<{ row: Row; created: boolean }> {
  const st = status ?? (src === "ai" || src === "mcp" ? "draft" : "published");
  const kind = input.kind ?? guessKind(input.url);
  const { rows: existing } = await c.query("SELECT * FROM content.resources WHERE master_item_id = $1 AND url = $2 AND deleted_at IS NULL", [archiveId, input.url]);
  if (existing[0]) {
    const { rows } = await c.query(
      `UPDATE content.resources SET title = $2, kind = $3, summary = $4, minutes = $5, tags = $6, source = $7, status = $8, updated_at = now() WHERE id = $1 RETURNING *`,
      [existing[0].id, input.title, input.kind ?? existing[0].kind, input.summary, input.minutes === undefined ? existing[0].minutes : input.minutes, input.tags ?? existing[0].tags, src, existing[0].status === "draft" ? "draft" : st],
    );
    return { row: rows[0]!, created: false };
  }
  const { rows: cnt } = await c.query("SELECT count(*)::int AS n, coalesce(max(ord), -1) + 1 AS next FROM content.resources WHERE master_item_id = $1 AND deleted_at IS NULL", [archiveId]);
  if (Number(cnt[0].n) >= MAX_RESOURCES) throw new HttpError(409, "too_many_resources", { max: MAX_RESOURCES });
  const { rows } = await c.query(
    `INSERT INTO content.resources (id, master_item_id, owner_id, kind, title, url, provider, summary, minutes, tags, status, source, ord)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [uuidv7(), archiveId, ownerId, kind, input.title, input.url, providerFor(input.url), input.summary, input.minutes ?? null, input.tags ?? [], st, src, cnt[0].next],
  );
  return { row: rows[0]!, created: true };
}

const stepMinutes = (s: Row) => s.minutes ?? s.r_minutes ?? null;

export interface RoadmapView {
  archiveId: string;
  exists: boolean;
  status: "draft" | "published" | null;
  summary: string;
  source: string | null;
  updatedAt: string | null;
  stages: Array<Row>;
  totals: { steps: number; required: number; done: number; doneRequired: number; percent: number; minutes: number; minutesLeft: number };
  next: { stepId: string; title: string; kind: string } | null;
}

interface Node {
  row: Row;
  out: Row;
  children: Node[];
}
interface Calc {
  minutes: number;
  left: number;
  leaves: number;
  done: number;
  required: number;
  doneRequired: number;
}
const zero = (): Calc => ({ minutes: 0, left: 0, leaves: 0, done: 0, required: 0, doneRequired: 0 });
const titleOf = (s: Row) => (s.kind === "milestone" ? s.title : s.kind === "item" ? s.item_title : s.r_title);

/**
 * Totals for one step. Only leaves carry ticks; a parent is done when everything it requires is done, and its own
 * minutes count only when the steps under it carry none (so a course of 90 minutes without timed lessons still counts).
 * A step is required only if every step above it is, so an optional course makes all its lessons optional.
 */
function calc(n: Node, parentRequired: boolean, next: { hit: Row | null }): Calc {
  const req = parentRequired && n.row.required;
  const own = stepMinutes(n.row) ?? 0;
  if (!n.children.length) {
    const done = !!n.row.done_at;
    n.out.done = done;
    n.out.effectiveRequired = req;
    if (req && !done) next.hit ??= n.row;
    return { minutes: own, left: req && !done ? own : 0, leaves: 1, done: done ? 1 : 0, required: req ? 1 : 0, doneRequired: req && done ? 1 : 0 };
  }
  const sum = zero();
  for (const ch of n.children) {
    const c = calc(ch, req, next);
    sum.minutes += c.minutes;
    sum.left += c.left;
    sum.leaves += c.leaves;
    sum.done += c.done;
    sum.required += c.required;
    sum.doneRequired += c.doneRequired;
  }
  if (sum.minutes === 0 && own > 0) {
    sum.minutes = own;
    sum.left = sum.required ? Math.round((own * (sum.required - sum.doneRequired)) / sum.required) : 0;
  }
  n.out.done = sum.required > 0 ? sum.doneRequired === sum.required : sum.done === sum.leaves;
  n.out.effectiveRequired = req;
  n.out.progress = { done: sum.done, total: sum.leaves };
  n.out.minutesTotal = sum.minutes || null;
  return sum;
}

/** The roadmap as one person sees it: only what they may read, with their own ticks and totals. */
export async function buildRoadmap(pool: Pool, userId: string, archiveId: string, rel: number): Promise<RoadmapView> {
  const editor = rel >= RANK.editor;
  const empty: RoadmapView = { archiveId, exists: false, status: null, summary: "", source: null, updatedAt: null, stages: [], totals: { steps: 0, required: 0, done: 0, doneRequired: 0, percent: 0, minutes: 0, minutesLeft: 0 }, next: null };
  const { rows: rm } = await pool.query("SELECT * FROM content.roadmaps WHERE master_item_id = $1", [archiveId]);
  const road = rm[0];
  if (!road || (road.status === "draft" && !editor)) return empty;
  const { rows: stages } = await pool.query("SELECT id, title, summary FROM content.roadmap_stages WHERE master_item_id = $1 ORDER BY ord", [archiveId]);
  const { rows: steps } = await pool.query(
    `SELECT st.*, p.done_at,
            s.kind AS item_kind, s.title AS item_title, s.summary AS item_summary, s.status AS item_status,
            r.kind AS r_kind, r.title AS r_title, r.url AS r_url, r.provider AS r_provider, r.summary AS r_summary, r.minutes AS r_minutes, r.status AS r_status, r.tags AS r_tags
       FROM content.roadmap_steps st
       JOIN content.roadmap_stages sg ON sg.id = st.stage_id
       LEFT JOIN content.sub_items s ON s.id = st.item_id
       LEFT JOIN content.resources r ON r.id = st.resource_id
       LEFT JOIN content.step_progress p ON p.step_id = st.id AND p.user_id = $2
      WHERE st.master_item_id = $1
        AND (st.item_id IS NULL OR (s.deleted_at IS NULL AND ($3::boolean OR s.status = 'published')))
        AND (st.resource_id IS NULL OR r.deleted_at IS NULL AND ($3::boolean OR r.status = 'published'))
      ORDER BY sg.ord, st.ord`,
    [archiveId, userId, editor],
  );
  // Build the tree. A step whose parent is hidden from this person is hidden with it.
  const nodes = new Map<string, Node>();
  for (const s of steps) {
    const out: Row = {
      id: s.id,
      kind: s.kind,
      required: s.required,
      minutes: stepMinutes(s),
      note: s.note,
      done: !!s.done_at,
      doneAt: s.done_at ?? null,
      children: [],
    };
    if (s.kind === "milestone") out.title = s.title;
    if (s.kind === "item") out.item = { id: s.item_id, kind: s.item_kind, title: s.item_title, summary: s.item_summary, status: s.item_status };
    if (s.kind === "resource") out.resource = { id: s.resource_id, kind: s.r_kind, title: s.r_title, url: s.r_url, provider: s.r_provider, summary: s.r_summary, minutes: s.r_minutes, tags: s.r_tags, status: s.r_status };
    nodes.set(s.id, { row: s, out, children: [] });
  }
  const roots = new Map<string, Node[]>();
  for (const s of steps) {
    const n = nodes.get(s.id)!;
    if (s.parent_id) nodes.get(s.parent_id)?.children.push(n);
    else (roots.get(s.stage_id) ?? roots.set(s.stage_id, []).get(s.stage_id)!).push(n);
  }
  const totals = { steps: 0, required: 0, done: 0, doneRequired: 0, percent: 0, minutes: 0, minutesLeft: 0 };
  const next = { hit: null as Row | null };
  const outStages = stages.map((st) => {
    const sum = zero();
    const top = roots.get(st.id) ?? [];
    for (const n of top) {
      const c = calc(n, true, next);
      for (const k of Object.keys(sum) as (keyof Calc)[]) sum[k] += c[k];
    }
    totals.steps += sum.leaves;
    totals.required += sum.required;
    totals.done += sum.done;
    totals.doneRequired += sum.doneRequired;
    totals.minutes += sum.minutes;
    totals.minutesLeft += sum.left;
    const attach = (n: Node): Row => ({ ...n.out, children: n.children.map(attach) });
    return { id: st.id, title: st.title, summary: st.summary, progress: { done: sum.done, total: sum.leaves }, steps: top.map(attach) };
  });
  totals.percent = totals.required ? Math.round((100 * totals.doneRequired) / totals.required) : totals.steps ? Math.round((100 * totals.done) / totals.steps) : 0;
  return {
    archiveId,
    exists: true,
    status: road.status,
    summary: road.summary,
    source: road.source,
    updatedAt: road.updated_at,
    stages: outStages,
    totals,
    next: next.hit ? { stepId: next.hit.id, kind: next.hit.kind, title: titleOf(next.hit) } : null,
  };
}

const countSteps = (steps: StepInput[] | undefined): number => (steps ?? []).reduce((n, s) => n + 1 + countSteps((s as { steps?: StepInput[] }).steps), 0);

/** Replace an archive's roadmap. Stage and step ids that are kept keep their progress; anything left out is removed. */
export async function saveRoadmap(pool: Pool, archiveId: string, userId: string, body: RoadmapInput): Promise<void> {
  const total = body.stages.reduce((n, s) => n + countSteps(s.steps), 0);
  if (total > MAX_STEPS) throw new HttpError(409, "too_many_steps", { max: MAX_STEPS });
  const status = body.status ?? (body.source === "ai" || body.source === "mcp" ? "draft" : "published");
  await tx(pool, async (c) => {
    const { rows: oldStages } = await c.query("SELECT id FROM content.roadmap_stages WHERE master_item_id = $1", [archiveId]);
    const { rows: oldSteps } = await c.query("SELECT id FROM content.roadmap_steps WHERE master_item_id = $1", [archiveId]);
    const haveStage = new Set(oldStages.map((x) => x.id as string));
    const haveStep = new Set(oldSteps.map((x) => x.id as string));
    const { rows: items } = await c.query("SELECT id FROM content.sub_items WHERE master_item_id = $1 AND deleted_at IS NULL", [archiveId]);
    const itemIds = new Set(items.map((x) => x.id as string));
    const { rows: res } = await c.query("SELECT id FROM content.resources WHERE master_item_id = $1 AND deleted_at IS NULL", [archiveId]);
    const resIds = new Set(res.map((x) => x.id as string));

    const keepStage = new Set<string>();
    const keepStep = new Set<string>();

    // Parents are written before their children, so a child's parent_id always points at a row that exists.
    async function writeSteps(list: StepInput[] | undefined, stageId: string, parentId: string | null): Promise<void> {
      let ord = 0;
      for (const s of list ?? []) {
        let kind: "item" | "resource" | "milestone";
        let itemId: string | null = null;
        let resourceId: string | null = null;
        const kids = (s as { steps?: StepInput[] }).steps;
        if (s.itemId) {
          if (!itemIds.has(s.itemId)) throw new HttpError(400, "invalid_request", { issues: [`itemId ${s.itemId}: not an item in this archive`] });
          kind = "item";
          itemId = s.itemId;
        } else if (s.resourceId) {
          if (!resIds.has(s.resourceId)) throw new HttpError(400, "invalid_request", { issues: [`resourceId ${s.resourceId}: not a resource in this archive`] });
          kind = "resource";
          resourceId = s.resourceId;
        } else if (s.resource) {
          // A link that has lessons under it is a course unless the author said otherwise.
          const input = kids?.length && !s.resource.kind && guessKind(s.resource.url) === "article" ? { ...s.resource, kind: "course" as const } : s.resource;
          const { row } = await upsertResource(c, archiveId, userId, input, body.source);
          resIds.add(row.id);
          kind = "resource";
          resourceId = row.id;
        } else kind = "milestone";
        const stepId = s.id && haveStep.has(s.id) ? s.id : uuidv7();
        if (keepStep.has(stepId)) throw new HttpError(400, "invalid_request", { issues: ["steps: the same step id appears twice"] });
        keepStep.add(stepId);
        const vals = [stepId, archiveId, stageId, ord++, kind, itemId, resourceId, s.milestone ?? "", s.note, s.required, s.minutes ?? null, parentId];
        if (haveStep.has(stepId)) {
          await c.query("UPDATE content.roadmap_steps SET stage_id = $3, ord = $4, kind = $5, item_id = $6, resource_id = $7, title = $8, note = $9, required = $10, minutes = $11, parent_id = $12 WHERE id = $1 AND master_item_id = $2", vals);
        } else {
          await c.query("INSERT INTO content.roadmap_steps (id, master_item_id, stage_id, ord, kind, item_id, resource_id, title, note, required, minutes, parent_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)", vals);
        }
        await writeSteps(kids, stageId, stepId);
      }
    }

    let stageOrd = 0;
    for (const st of body.stages) {
      const stageId = st.id && haveStage.has(st.id) ? st.id : uuidv7();
      if (keepStage.has(stageId)) throw new HttpError(400, "invalid_request", { issues: ["stages: the same stage id appears twice"] });
      keepStage.add(stageId);
      if (haveStage.has(stageId)) await c.query("UPDATE content.roadmap_stages SET ord = $2, title = $3, summary = $4 WHERE id = $1", [stageId, stageOrd, st.title, st.summary]);
      else await c.query("INSERT INTO content.roadmap_stages (id, master_item_id, ord, title, summary) VALUES ($1,$2,$3,$4,$5)", [stageId, archiveId, stageOrd, st.title, st.summary]);
      stageOrd++;
      await writeSteps(st.steps, stageId, null);
    }
    await c.query("DELETE FROM content.roadmap_steps WHERE master_item_id = $1 AND NOT (id = ANY($2::uuid[]))", [archiveId, [...keepStep]]);
    await c.query("DELETE FROM content.roadmap_stages WHERE master_item_id = $1 AND NOT (id = ANY($2::uuid[]))", [archiveId, [...keepStage]]);
    await c.query(
      `INSERT INTO content.roadmaps (master_item_id, summary, status, source, updated_by) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (master_item_id) DO UPDATE SET summary = EXCLUDED.summary, status = EXCLUDED.status, source = EXCLUDED.source, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [archiveId, body.summary, status, body.source, userId],
    );
    await c.query("UPDATE content.master_items SET updated_at = now() WHERE id = $1", [archiveId]);
  });
}


/** The stored roadmap in the shape `saveRoadmap` takes, with every id kept (nothing is filtered by who is asking). */
export async function loadRoadmapInput(pool: Pool, archiveId: string): Promise<{ exists: boolean; status: "draft" | "published"; summary: string; stages: RoadmapInput["stages"] }> {
  const { rows: rm } = await pool.query("SELECT summary, status FROM content.roadmaps WHERE master_item_id = $1", [archiveId]);
  if (!rm[0]) return { exists: false, status: "published", summary: "", stages: [] };
  const { rows: stages } = await pool.query("SELECT id, title, summary FROM content.roadmap_stages WHERE master_item_id = $1 ORDER BY ord", [archiveId]);
  const { rows: steps } = await pool.query("SELECT * FROM content.roadmap_steps WHERE master_item_id = $1 ORDER BY ord", [archiveId]);
  const make = (r: Row): StepInput => {
    const kids = steps.filter((x) => x.parent_id === r.id).map(make);
    const target = r.kind === "item" ? { itemId: r.item_id } : r.kind === "resource" ? { resourceId: r.resource_id } : { milestone: r.title };
    return { id: r.id, ...target, note: r.note, required: r.required, minutes: r.minutes, ...(kids.length ? { steps: kids } : {}) } as StepInput;
  };
  return {
    exists: true,
    status: rm[0].status,
    summary: rm[0].summary,
    stages: stages.map((st) => ({ id: st.id, title: st.title, summary: st.summary, steps: steps.filter((x) => x.stage_id === st.id && !x.parent_id).map(make) })),
  };
}

export function roadmapRoutes(ctx: Ctx) {
  const { pool } = ctx;
  return async (r: FastifyInstance) => {
    async function archiveFor(req: Parameters<typeof idParam>[0], scope: "content:read" | "content:write", min: number) {
      const a = await ctx.actor(req, scope);
      const loaded = await loadArchive(pool, a, idParam(req));
      need(loaded.rel, min);
      return { a, ...loaded };
    }

    // ---- resources -------------------------------------------------------
    r.get("/v1/archives/:id/resources", async (req) => {
      const { rel, row } = await archiveFor(req, "content:read", RANK.viewer);
      const q = parse(z.object({ kind: z.enum(RESOURCE_KINDS).optional() }), req.query);
      const { rows } = await pool.query(
        "SELECT * FROM content.resources WHERE master_item_id = $1 AND deleted_at IS NULL AND ($2::boolean OR status = 'published') AND ($3::text IS NULL OR kind = $3) ORDER BY ord, created_at",
        [row.id, rel >= RANK.editor, q.kind ?? null],
      );
      return { resources: rows.map(resourceOut) };
    });

    r.post("/v1/archives/:id/resources", async (req, reply) => {
      const { a, rel, row } = await archiveFor(req, "content:write", RANK.editor);
      const body = parse(resourceInput.extend({ source: source.default("human"), status: z.enum(["draft", "published"]).optional() }), req.body);
      const { source: src, status, ...input } = body;
      const { row: res, created } = await upsertResource(pool, row.id, a.userId, input, src, status);
      await pool.query("UPDATE content.master_items SET updated_at = now() WHERE id = $1", [row.id]);
      void rel;
      return reply.code(created ? 201 : 200).send(resourceOut(res));
    });

    r.post("/v1/archives/:id/resources/bulk", async (req, reply) => {
      const { a, row } = await archiveFor(req, "content:write", RANK.editor);
      const body = parse(z.object({ resources: z.array(resourceInput).min(1).max(100), source: source.default("human") }), req.body);
      const out = await tx(pool, async (c) => {
        const list = [];
        for (const input of body.resources) list.push(await upsertResource(c, row.id, a.userId, input, body.source));
        await c.query("UPDATE content.master_items SET updated_at = now() WHERE id = $1", [row.id]);
        return list;
      });
      return reply.code(201).send({ resources: out.map((x) => ({ ...resourceOut(x.row), created: x.created })) });
    });

    async function resourceFor(req: Parameters<typeof idParam>[0], scope: "content:read" | "content:write", min: number) {
      const a = await ctx.actor(req, scope);
      const { rows } = await pool.query("SELECT * FROM content.resources WHERE id = $1 AND deleted_at IS NULL", [idParam(req)]);
      if (!rows[0]) throw new HttpError(404, "not_found");
      const { rel } = await loadArchive(pool, a, rows[0].master_item_id);
      need(rel, min);
      if (rows[0].status === "draft" && rel < RANK.editor) throw new HttpError(404, "not_found");
      return { a, rel, row: rows[0] };
    }

    r.get("/v1/resources/:id", async (req) => resourceOut((await resourceFor(req, "content:read", RANK.viewer)).row));

    r.patch("/v1/resources/:id", async (req) => {
      const { row } = await resourceFor(req, "content:write", RANK.editor);
      const body = parse(resourcePatch, req.body);
      const set: string[] = [];
      const vals: unknown[] = [];
      const add = (col: string, v: unknown) => {
        vals.push(v);
        set.push(`${col} = $${vals.length}`);
      };
      if (body.url !== undefined) {
        add("url", body.url);
        add("provider", providerFor(body.url));
      }
      if (body.title !== undefined) add("title", body.title);
      if (body.kind !== undefined) add("kind", body.kind);
      if (body.summary !== undefined) add("summary", body.summary);
      if (body.minutes !== undefined) add("minutes", body.minutes);
      if (body.tags !== undefined) add("tags", body.tags);
      if (body.status !== undefined) add("status", body.status);
      if (body.order !== undefined) add("ord", body.order);
      if (!set.length) return resourceOut(row);
      vals.push(row.id);
      try {
        const { rows } = await pool.query(`UPDATE content.resources SET ${set.join(", ")}, updated_at = now() WHERE id = $${vals.length} RETURNING *`, vals);
        return resourceOut(rows[0]!);
      } catch (e) {
        if ((e as { code?: string }).code === "23505") throw new HttpError(409, "resource_exists");
        throw e;
      }
    });

    // Deleting a resource also removes it from the roadmap, and people's ticks on that step.
    r.delete("/v1/resources/:id", async (req, reply) => {
      const { row } = await resourceFor(req, "content:write", RANK.editor);
      await pool.query("DELETE FROM content.resources WHERE id = $1", [row.id]);
      return reply.code(204).send();
    });

    // ---- roadmap ---------------------------------------------------------
    r.get("/v1/archives/:id/roadmap", async (req) => {
      const { a, rel, row } = await archiveFor(req, "content:read", RANK.viewer);
      return buildRoadmap(pool, a.userId, row.id, rel);
    });

    r.put("/v1/archives/:id/roadmap", async (req) => {
      const { a, row } = await archiveFor(req, "content:write", RANK.editor);
      const body = parse(roadmapInput, req.body);
      await saveRoadmap(pool, row.id, a.userId, body);
      return buildRoadmap(pool, a.userId, row.id, RANK.editor);
    });


    /** Paste an outline (see outline.ts) to add to the roadmap, or replace it. Item titles in [[double brackets]] are matched to this archive's material. */
    r.post("/v1/archives/:id/roadmap/outline", async (req) => {
      const { a, row } = await archiveFor(req, "content:write", RANK.editor);
      const body = parse(z.object({ outline: z.string().min(1).max(200_000), mode: z.enum(["append", "replace"]).default("append"), status: z.enum(["draft", "published"]).optional(), source: source.default("human") }), req.body);
      const outline = parseOutline(body.outline);
      const { rows: items } = await pool.query("SELECT id, title FROM content.sub_items WHERE master_item_id = $1 AND deleted_at IS NULL", [row.id]);
      const byTitle = new Map(items.map((x) => [String(x.title).trim().toLowerCase(), x.id as string]));
      const warnings = [...outline.warnings];
      const convert = (o: OutlineStep): StepInput => {
        const common = { note: o.note, required: o.required, minutes: o.minutes ?? undefined };
        const kids = o.steps.length ? { steps: o.steps.map(convert) as never } : {};
        if (o.itemTitle) {
          const id = byTitle.get(o.itemTitle.toLowerCase());
          if (id) return { ...common, itemId: id, ...kids } as StepInput;
          warnings.push(`"${o.itemTitle}" is not a guide, deck or quiz in this archive, so it became a checkpoint.`);
          return { ...common, milestone: o.itemTitle.slice(0, 160), ...kids } as StepInput;
        }
        if (o.link) return { note: o.note, required: o.required, resource: { url: o.link.url, title: o.link.title, summary: "", minutes: o.minutes }, ...kids } as StepInput;
        return { ...common, milestone: o.milestone ?? "Checkpoint", ...kids } as StepInput;
      };
      const added = outline.stages.map((st) => ({ title: st.title, summary: st.summary, steps: st.steps.map(convert) }));
      if (!added.length) throw new HttpError(400, "invalid_request", { issues: ["outline: no stages or list items found"] });
      const existing = body.mode === "append" ? await loadRoadmapInput(pool, row.id) : null;
      const stages = [...(existing?.stages ?? []), ...added] as RoadmapInput["stages"];
      if (stages.length > MAX_STAGES) throw new HttpError(409, "too_many_stages", { max: MAX_STAGES });
      const status = body.status ?? (body.source === "ai" || body.source === "mcp" ? "draft" : existing?.exists ? existing.status : "published");
      await saveRoadmap(pool, row.id, a.userId, { summary: existing?.summary || outline.summary, stages, status, source: body.source });
      return { ...(await buildRoadmap(pool, a.userId, row.id, RANK.editor)), warnings };
    });

    r.patch("/v1/archives/:id/roadmap", async (req) => {
      const { a, row } = await archiveFor(req, "content:write", RANK.editor);
      const body = parse(z.object({ status: z.enum(["draft", "published"]) }), req.body);
      const { rowCount } = await pool.query("UPDATE content.roadmaps SET status = $2, updated_by = $3, updated_at = now() WHERE master_item_id = $1", [row.id, body.status, a.userId]);
      if (!rowCount) throw new HttpError(404, "not_found");
      return buildRoadmap(pool, a.userId, row.id, RANK.editor);
    });

    r.delete("/v1/archives/:id/roadmap", async (req, reply) => {
      const { row } = await archiveFor(req, "content:write", RANK.editor);
      await tx(pool, async (c) => {
        await c.query("DELETE FROM content.roadmap_stages WHERE master_item_id = $1", [row.id]);
        await c.query("DELETE FROM content.roadmaps WHERE master_item_id = $1", [row.id]);
      });
      return reply.code(204).send();
    });

    // ---- progress --------------------------------------------------------
    r.put("/v1/roadmap/steps/:id/progress", async (req) => {
      const a = await ctx.actor(req, "content:write");
      const body = parse(z.object({ done: z.boolean() }), req.body);
      const { rows } = await pool.query("SELECT master_item_id FROM content.roadmap_steps WHERE id = $1", [idParam(req)]);
      if (!rows[0]) throw new HttpError(404, "not_found");
      const { rel, row } = await loadArchive(pool, a, rows[0].master_item_id);
      need(rel, RANK.viewer);
      // Only steps this person can see can be ticked. A parent ticks everything under it.
      const view = await buildRoadmap(pool, a.userId, row.id, rel);
      const find = (steps: Row[]): Row | undefined => {
        for (const x of steps) {
          if (x.id === idParam(req)) return x;
          const hit = find(x.children);
          if (hit) return hit;
        }
        return undefined;
      };
      let target: Row | undefined;
      for (const st of view.stages) target ??= find(st.steps);
      if (!target) throw new HttpError(404, "not_found");
      const leaves: string[] = [];
      const walk = (x: Row) => (x.children.length ? x.children.forEach(walk) : leaves.push(x.id));
      walk(target);
      if (body.done) await pool.query("INSERT INTO content.step_progress (user_id, step_id, archive_id) SELECT $1, unnest($2::uuid[]), $3 ON CONFLICT DO NOTHING", [a.userId, leaves, row.id]);
      else await pool.query("DELETE FROM content.step_progress WHERE user_id = $1 AND step_id = ANY($2::uuid[])", [a.userId, leaves]);
      const fresh = await buildRoadmap(pool, a.userId, row.id, rel);
      return { done: body.done, totals: fresh.totals, next: fresh.next };
    });

    /** Where the person is on every roadmap they can read: for the dashboard. */
    r.get("/v1/roadmaps", async (req) => {
      const a: Actor = await ctx.actor(req, "content:read");
      const { rows } = await pool.query(
        `SELECT m.id, m.title, m.icon_kind, m.icon_name, m.icon_asset_id, ${ARCHIVE_REL} AS rel,
                (SELECT max(p.done_at) FROM content.step_progress p WHERE p.user_id = $1 AND p.archive_id = m.id) AS last_done
           FROM content.master_items m JOIN content.roadmaps rm ON rm.master_item_id = m.id AND rm.status = 'published'
          WHERE m.deleted_at IS NULL
            AND ${ARCHIVE_REL} >= 2
          ORDER BY last_done DESC NULLS LAST, rm.updated_at DESC LIMIT 12`,
        [a.userId, a.groups],
      );
      const out = [];
      for (const m of rows) {
        const v = await buildRoadmap(pool, a.userId, m.id, Number(m.rel));
        if (!v.exists || !v.totals.steps) continue;
        out.push({
          archiveId: m.id,
          title: m.title,
          icon: { kind: m.icon_kind, name: m.icon_name, url: m.icon_asset_id ? `/api/v1/assets/${m.icon_asset_id}` : null },
          started: !!m.last_done,
          lastDoneAt: m.last_done,
          totals: v.totals,
          next: v.next,
        });
      }
      return { roadmaps: out };
    });
  };
}
