import { HttpError, idParam, parse, tx, uuidv7 } from "@ultimyr/service-kit";
import type { FastifyInstance } from "fastify";
import type { PoolClient } from "pg";
import { z } from "zod";
import { RANK, loadArchive, need, type Actor } from "../access.js";
import type { Ctx } from "../ctx.js";
import { parseObjectives } from "../objective-outline.js";

const MAX_DOMAINS = 40;
const MAX_PER_DOMAIN = 40;
const MAX_LINKS_PER_TARGET = 30;

const leaf = z.object({
  id: z.uuid().optional().describe("Keep an objective's id to keep what is linked to it."),
  code: z.string().trim().max(20).default(""),
  title: z.string().trim().min(1).max(300),
  summary: z.string().max(1000).default(""),
});
const domain = leaf.extend({
  weightBp: z.number().int().min(0).max(10_000).nullable().optional(),
  children: z.array(leaf).max(MAX_PER_DOMAIN).default([]),
});
export const objectivesInput = z.object({ objectives: z.array(domain).max(MAX_DOMAINS) });
export type ObjectivesInput = z.infer<typeof objectivesInput>;

const importBody = z.object({
  text: z.string().min(1).max(60_000),
  /** Replace the whole list instead of merging into it. Links on objectives that disappear are removed. */
  replace: z.boolean().default(false),
});
const linkKinds = ["item", "card", "resource"] as const;
const setLinksBody = z.object({ kind: z.enum(linkKinds), refId: z.uuid(), objectiveIds: z.array(z.uuid()).max(MAX_LINKS_PER_TARGET) });

type Row = Record<string, any>;
export interface Counts {
  guides: number;
  decks: number;
  cards: number;
  resources: number;
}
export interface ObjectiveOut {
  id: string;
  code: string;
  title: string;
  summary: string;
  weightBp: number | null;
  order: number;
  counts: Counts;
  children?: ObjectiveOut[];
}

export function objectiveRoutes(ctx: Ctx) {
  const { pool } = ctx;

  async function load(archiveId: string): Promise<Row[]> {
    const { rows } = await pool.query("SELECT * FROM content.objectives WHERE archive_id = $1 ORDER BY ord, code", [archiveId]);
    return rows;
  }

  /** Published material linked to each objective, as (objective, bucket, id). Deck cards count as cards. */
  async function linked(archiveId: string): Promise<Array<{ objective_id: string; bucket: "guide" | "deck" | "card" | "resource"; ref_id: string }>> {
    const { rows } = await pool.query(
      `SELECT l.objective_id, s.kind AS bucket, l.ref_id FROM content.objective_links l
         JOIN content.sub_items s ON s.id = l.ref_id AND s.master_item_id = $1 AND s.deleted_at IS NULL AND s.status = 'published' AND s.kind IN ('guide', 'deck')
        WHERE l.archive_id = $1 AND l.kind = 'item'
       UNION ALL
       SELECT l.objective_id, 'card', c.id FROM content.objective_links l
         JOIN content.cards c ON c.deck_id = l.ref_id
         JOIN content.sub_items s ON s.id = c.deck_id AND s.master_item_id = $1 AND s.deleted_at IS NULL AND s.status = 'published'
        WHERE l.archive_id = $1 AND l.kind = 'item'
       UNION ALL
       SELECT l.objective_id, 'card', c.id FROM content.objective_links l
         JOIN content.cards c ON c.id = l.ref_id
         JOIN content.sub_items s ON s.id = c.deck_id AND s.master_item_id = $1 AND s.deleted_at IS NULL AND s.status = 'published'
        WHERE l.archive_id = $1 AND l.kind = 'card'
       UNION ALL
       SELECT l.objective_id, 'resource', r.id FROM content.objective_links l
         JOIN content.resources r ON r.id = l.ref_id AND r.master_item_id = $1 AND r.deleted_at IS NULL AND r.status = 'published'
        WHERE l.archive_id = $1 AND l.kind = 'resource'`,
      [archiveId],
    );
    return rows;
  }

  /** The tree with counts. A domain counts each piece of material once, however many of its objectives it supports. */
  async function tree(archiveId: string): Promise<ObjectiveOut[]> {
    const [rows, links] = await Promise.all([load(archiveId), linked(archiveId)]);
    const own = new Map<string, Record<"guide" | "deck" | "card" | "resource", Set<string>>>();
    for (const l of links) {
      const e = own.get(l.objective_id) ?? { guide: new Set(), deck: new Set(), card: new Set(), resource: new Set() };
      e[l.bucket].add(l.ref_id);
      own.set(l.objective_id, e);
    }
    const counts = (ids: string[]): Counts => {
      const u = { guide: new Set<string>(), deck: new Set<string>(), card: new Set<string>(), resource: new Set<string>() };
      for (const id of ids) for (const k of Object.keys(u) as Array<keyof typeof u>) for (const v of own.get(id)?.[k] ?? []) u[k].add(v);
      return { guides: u.guide.size, decks: u.deck.size, cards: u.card.size, resources: u.resource.size };
    };
    const base = (r: Row) => ({ id: r.id as string, code: r.code as string, title: r.title as string, summary: r.summary as string, weightBp: (r.weight_bp ?? null) as number | null, order: r.ord as number });
    return rows
      .filter((r) => !r.parent_id)
      .map((d) => {
        const kids = rows.filter((c) => c.parent_id === d.id);
        return { ...base(d), counts: counts([d.id, ...kids.map((k) => k.id)]), children: kids.map((k) => ({ ...base(k), counts: counts([k.id]) })) };
      });
  }

  /** Replace the list inside a transaction. Ids that are kept keep their links; ids that are dropped lose them. */
  async function save(c: PoolClient, archiveId: string, input: ObjectivesInput): Promise<void> {
    const { rows: existing } = await c.query("SELECT id FROM content.objectives WHERE archive_id = $1", [archiveId]);
    const known = new Set(existing.map((r) => r.id as string));
    const given = new Set<string>();
    for (const d of input.objectives)
      for (const o of [d, ...d.children]) {
        if (!o.id) continue;
        if (!known.has(o.id)) throw new HttpError(400, "invalid_request", { issues: [`id ${o.id} is not an objective of this archive`] });
        if (given.has(o.id)) throw new HttpError(400, "invalid_request", { issues: [`id ${o.id} appears twice`] });
        given.add(o.id);
      }
    const weights = input.objectives.reduce((s, d) => s + (d.weightBp ?? 0), 0);
    if (weights > 10_000) throw new HttpError(400, "invalid_request", { issues: ["domain weights add up to more than 100%"] });
    const drop = [...known].filter((id) => !given.has(id));
    // A kept objective that moves under a different domain must not be cascaded away with the domain it leaves.
    if (given.size) await c.query("UPDATE content.objectives SET parent_id = NULL WHERE archive_id = $1 AND id = ANY($2::uuid[])", [archiveId, [...given]]);
    if (drop.length) await c.query("DELETE FROM content.objectives WHERE archive_id = $1 AND id = ANY($2::uuid[])", [archiveId, drop]);
    const put = async (o: { id?: string; code: string; title: string; summary: string }, parent: string | null, ord: number, weight: number | null) => {
      const id = o.id ?? uuidv7();
      if (o.id) await c.query("UPDATE content.objectives SET parent_id = $2, ord = $3, code = $4, title = $5, summary = $6, weight_bp = $7, updated_at = now() WHERE id = $1", [id, parent, ord, o.code, o.title, o.summary, weight]);
      else await c.query("INSERT INTO content.objectives (id, archive_id, parent_id, ord, code, title, summary, weight_bp) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [id, archiveId, parent, ord, o.code, o.title, o.summary, weight]);
      return id;
    };
    // Move existing rows to the top level first so a child that becomes a domain never points at a row about to change.
    for (const [i, d] of input.objectives.entries()) {
      const id = await put(d, null, i, d.weightBp ?? null);
      for (const [j, k] of d.children.entries()) await put(k, id, j, null);
    }
  }

  const editable = async (a: Actor, archiveId: string) => need((await loadArchive(pool, a, archiveId)).rel, RANK.editor);
  const readable = async (a: Actor, archiveId: string) => need((await loadArchive(pool, a, archiveId)).rel, RANK.viewer);

  /** Check that every objective belongs to the archive. */
  async function ownObjectives(archiveId: string, ids: string[]) {
    if (!ids.length) return;
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM content.objectives WHERE archive_id = $1 AND id = ANY($2::uuid[])", [archiveId, ids]);
    if (rows[0].n !== new Set(ids).size) throw new HttpError(400, "invalid_request", { issues: ["objectiveIds: each must be an objective of this archive"] });
  }

  /** Check that the thing being linked is in this archive, and is a kind that can be linked. */
  async function ownTarget(archiveId: string, kind: (typeof linkKinds)[number], refId: string) {
    const q =
      kind === "item"
        ? pool.query("SELECT 1 FROM content.sub_items WHERE id = $1 AND master_item_id = $2 AND deleted_at IS NULL AND kind IN ('guide', 'deck')", [refId, archiveId])
        : kind === "card"
          ? pool.query("SELECT 1 FROM content.cards c JOIN content.sub_items s ON s.id = c.deck_id WHERE c.id = $1 AND s.master_item_id = $2 AND s.deleted_at IS NULL", [refId, archiveId])
          : pool.query("SELECT 1 FROM content.resources WHERE id = $1 AND master_item_id = $2 AND deleted_at IS NULL", [refId, archiveId]);
    if (!(await q).rowCount) throw new HttpError(404, "not_found");
  }

  return async (r: FastifyInstance) => {
    r.get("/v1/archives/:id/objectives", async (req) => {
      const a = await ctx.actor(req, "content:read");
      const id = idParam(req);
      await readable(a, id);
      return { archiveId: id, objectives: await tree(id) };
    });

    r.put("/v1/archives/:id/objectives", async (req) => {
      const a = await ctx.actor(req, "content:write");
      const id = idParam(req);
      await editable(a, id);
      const body = parse(objectivesInput, req.body);
      await tx(pool, (c) => save(c, id, body));
      return { archiveId: id, objectives: await tree(id) };
    });

    /** Paste an exam outline. Merges by code (or title) so links survive; `replace` starts over. */
    r.post("/v1/archives/:id/objectives/import", async (req) => {
      const a = await ctx.actor(req, "content:write");
      const id = idParam(req);
      await editable(a, id);
      const body = parse(importBody, req.body);
      const parsed = parseObjectives(body.text);
      if (!parsed.domains.length) throw new HttpError(400, "invalid_request", { issues: ["no objectives found in that text"] });
      const key = (o: { code: string; title: string }) => (o.code ? `c:${o.code.toLowerCase()}` : `t:${o.title.toLowerCase()}`);

      const current = body.replace ? [] : await tree(id);
      type Draft = ObjectivesInput["objectives"][number];
      const next: Draft[] = current.map((d) => ({
        id: d.id,
        code: d.code,
        title: d.title,
        summary: d.summary,
        weightBp: d.weightBp,
        children: (d.children ?? []).map((k) => ({ id: k.id, code: k.code, title: k.title, summary: k.summary })),
      }));
      let added = 0;
      let updated = 0;
      for (const p of parsed.domains) {
        let d = next.find((x) => key(x) === key(p));
        if (d) {
          if (d.title !== p.title || (p.weightBp !== null && d.weightBp !== p.weightBp)) updated++;
          d.title = p.title;
          if (p.weightBp !== null) d.weightBp = p.weightBp;
        } else {
          d = { code: p.code, title: p.title, summary: "", weightBp: p.weightBp, children: [] };
          next.push(d);
          added++;
        }
        for (const o of p.children) {
          const k = d.children.find((x) => key(x) === key(o));
          if (k) {
            if (k.title !== o.title) updated++;
            k.title = o.title;
          } else {
            d.children.push({ code: o.code, title: o.title, summary: "" });
            added++;
          }
        }
      }
      const warnings = [...parsed.warnings];
      if (next.length > MAX_DOMAINS || next.some((d) => d.children.length > MAX_PER_DOMAIN)) throw new HttpError(400, "invalid_request", { issues: [`at most ${MAX_DOMAINS} domains with ${MAX_PER_DOMAIN} objectives each`] });
      await tx(pool, (c) => save(c, id, { objectives: next }));
      return { archiveId: id, added, updated, warnings, objectives: await tree(id) };
    });

    /** Which objectives is this guide, deck, card or resource linked to? */
    r.get("/v1/archives/:id/links", async (req) => {
      const a = await ctx.actor(req, "content:read");
      const id = idParam(req);
      await readable(a, id);
      const q = parse(z.object({ kind: z.enum(linkKinds), refId: z.uuid() }), req.query);
      const { rows } = await pool.query("SELECT objective_id FROM content.objective_links WHERE archive_id = $1 AND kind = $2 AND ref_id = $3", [id, q.kind, q.refId]);
      return { kind: q.kind, refId: q.refId, objectiveIds: rows.map((x) => x.objective_id as string) };
    });

    /** Set exactly which objectives a guide, deck, card or resource supports. */
    r.put("/v1/archives/:id/links", async (req) => {
      const a = await ctx.actor(req, "content:write");
      const id = idParam(req);
      await editable(a, id);
      const body = parse(setLinksBody, req.body);
      const ids = [...new Set(body.objectiveIds)];
      await ownObjectives(id, ids);
      await ownTarget(id, body.kind, body.refId);
      await tx(pool, async (c) => {
        await c.query("DELETE FROM content.objective_links WHERE archive_id = $1 AND kind = $2 AND ref_id = $3 AND NOT (objective_id = ANY($4::uuid[]))", [id, body.kind, body.refId, ids]);
        for (const o of ids) await c.query("INSERT INTO content.objective_links (objective_id, archive_id, kind, ref_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING", [o, id, body.kind, body.refId]);
      });
      return { kind: body.kind, refId: body.refId, objectiveIds: ids };
    });
  };
}
