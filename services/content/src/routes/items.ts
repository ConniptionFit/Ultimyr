import { HttpError, idParam, parse, tx, uuidv7, type Pool } from "@ultimyr/service-kit";
import type { PoolClient } from "pg";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { RANK, loadArchive, loadItem, need } from "../access.js";
import type { Ctx } from "../ctx.js";
import { splitSections } from "../markdown.js";
import { itemSummary } from "./archives.js";

export const MAX_MARKDOWN = 500_000;
export const MAX_CARDS = 5000;
const source = z.enum(["human", "ai", "mcp", "import"]);

export const cardInput = z.object({
  id: z.uuid().optional(),
  front: z.string().trim().min(1).max(5000),
  back: z.string().trim().min(1).max(10_000),
  hint: z.string().max(1000).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
});
export type CardInput = z.infer<typeof cardInput>;

const createBody = z.object({
  kind: z.enum(["guide", "deck", "quiz"]),
  title: z.string().trim().min(1).max(160),
  summary: z.string().max(2000).default(""),
  markdown: z.string().max(MAX_MARKDOWN).optional(),
  cards: z.array(cardInput).max(MAX_CARDS).optional(),
  status: z.enum(["draft", "published"]).optional(),
  source: source.default("human"),
});
const patchBody = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  summary: z.string().max(2000).optional(),
  markdown: z.string().max(MAX_MARKDOWN).optional(),
  status: z.enum(["draft", "published"]).optional(),
  order: z.number().int().min(0).max(100_000).optional(),
  note: z.string().max(200).optional(),
  source: source.default("human"),
});

/** Write a new version of an item and make it current. Guides also get their sections rebuilt for deep links and search. */
export async function addVersion(c: PoolClient, item: { id: string; kind: string }, body: unknown, authorId: string, src: string, note?: string | null): Promise<number> {
  const { rows } = await c.query("SELECT coalesce(max(version_no), 0) + 1 AS n FROM content.item_versions WHERE sub_item_id = $1", [item.id]);
  const n = Number(rows[0].n);
  const versionId = uuidv7();
  await c.query("INSERT INTO content.item_versions (id, sub_item_id, version_no, body, author_id, source, note) VALUES ($1,$2,$3,$4,$5,$6,$7)", [
    versionId,
    item.id,
    n,
    JSON.stringify(body),
    authorId,
    src,
    note ?? null,
  ]);
  if (item.kind === "guide") {
    const md = (body as { markdown: string }).markdown;
    for (const s of splitSections(md)) {
      await c.query("INSERT INTO content.guide_sections (version_id, sub_item_id, ord, anchor, heading, md_body) VALUES ($1,$2,$3,$4,$5,$6)", [versionId, item.id, s.ord, s.anchor, s.heading, s.body]);
    }
  }
  await c.query("UPDATE content.sub_items SET current_version_id = $1, updated_at = now() WHERE id = $2", [versionId, item.id]);
  await c.query("UPDATE content.master_items SET updated_at = now() WHERE id = (SELECT master_item_id FROM content.sub_items WHERE id = $1)", [item.id]);
  return n;
}

async function deckSnapshot(c: PoolClient | Pool, deckId: string) {
  const { rows } = await c.query("SELECT id, front, back, hint, tags, ord FROM content.cards WHERE deck_id = $1 ORDER BY ord, created_at", [deckId]);
  return { cards: rows.map((x) => ({ id: x.id, front: x.front, back: x.back, hint: x.hint, tags: x.tags, order: x.ord })) };
}

/** Insert or update cards in a deck. Cards with an existing id are updated in place; the rest are appended. */
export async function upsertCards(c: PoolClient, deckId: string, cards: CardInput[]): Promise<string[]> {
  const { rows: cnt } = await c.query("SELECT count(*)::int AS n, coalesce(max(ord), -1) AS m FROM content.cards WHERE deck_id = $1", [deckId]);
  let next = Number(cnt[0].m) + 1;
  const ids: string[] = [];
  let created = 0;
  for (const card of cards) {
    if (card.id) {
      const { rowCount } = await c.query(
        "UPDATE content.cards SET front = $3, back = $4, hint = $5, tags = coalesce($6, tags), updated_at = now() WHERE id = $1 AND deck_id = $2",
        [card.id, deckId, card.front, card.back, card.hint ?? null, card.tags ?? null],
      );
      if (rowCount) {
        ids.push(card.id);
        continue;
      }
    }
    const id = uuidv7();
    await c.query("INSERT INTO content.cards (id, deck_id, ord, front, back, hint, tags) VALUES ($1,$2,$3,$4,$5,$6,$7)", [id, deckId, next++, card.front, card.back, card.hint ?? null, card.tags ?? []]);
    ids.push(id);
    created++;
  }
  if (Number(cnt[0].n) + created > MAX_CARDS) throw new HttpError(409, "too_many_cards", { max: MAX_CARDS });
  return ids;
}

/** Create an item in an archive. Shared by REST and import. */
export async function createItem(
  pool: Pool,
  archiveId: string,
  authorId: string,
  body: z.infer<typeof createBody>,
): Promise<Record<string, any>> {
  if (body.kind === "guide" && body.cards) throw new HttpError(400, "invalid_request", { issues: ["cards: only decks have cards"] });
  if (body.kind !== "guide" && body.markdown !== undefined) throw new HttpError(400, "invalid_request", { issues: ["markdown: only guides have markdown"] });
  const status = body.status ?? (body.source === "ai" || body.source === "mcp" ? "draft" : "published");
  return tx(pool, async (c) => {
    const { rows: ord } = await c.query("SELECT coalesce(max(ord), -1) + 1 AS n FROM content.sub_items WHERE master_item_id = $1", [archiveId]);
    const id = uuidv7();
    const { rows } = await c.query(
      "INSERT INTO content.sub_items (id, master_item_id, kind, title, summary, owner_id, status, ai_status, ord) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
      [id, archiveId, body.kind, body.title, body.summary, authorId, status, body.source === "ai" ? "draft" : "none", ord[0].n],
    );
    const row = rows[0]!;
    if (body.kind === "guide") await addVersion(c, row as any, { markdown: body.markdown ?? "" }, authorId, body.source);
    if (body.kind === "deck") {
      if (body.cards?.length) await upsertCards(c, id, body.cards.map(({ id: _drop, ...rest }) => rest));
      await addVersion(c, row as any, await deckSnapshot(c, id), authorId, body.source);
    }
    await c.query("UPDATE content.master_items SET updated_at = now() WHERE id = $1", [archiveId]);
    return row;
  });
}
export { createBody as createItemBody };

export async function itemDetail(pool: Pool, row: Record<string, any>, rel: number) {
  const out: Record<string, any> = { ...itemSummary(row, rel), archive: { id: row.master_item_id, title: row.archive_title } };
  if (row.kind === "guide") {
    const { rows: v } = await pool.query("SELECT id, version_no, body, source, author_id, created_at FROM content.item_versions WHERE id = $1", [row.current_version_id]);
    const { rows: secs } = await pool.query("SELECT ord, anchor, heading, md_body FROM content.guide_sections WHERE version_id = $1 ORDER BY ord", [row.current_version_id]);
    out.markdown = v[0]?.body.markdown ?? "";
    out.version = v[0] ? { number: v[0].version_no, source: v[0].source, authorId: v[0].author_id, createdAt: v[0].created_at } : null;
    out.sections = secs.map((s) => ({ order: s.ord, anchor: s.anchor, heading: s.heading, body: s.md_body }));
  } else if (row.kind === "deck") {
    const { rows: cards } = await pool.query("SELECT id, front, back, hint, tags, ord FROM content.cards WHERE deck_id = $1 ORDER BY ord, created_at", [row.id]);
    out.cards = cards.map((x) => ({ id: x.id, front: x.front, back: x.back, hint: x.hint, tags: x.tags, order: x.ord }));
  }
  return out;
}

export function itemRoutes(ctx: Ctx) {
  const { pool } = ctx;
  return async (r: FastifyInstance) => {
    r.post("/v1/archives/:id/items", async (req, reply) => {
      const a = await ctx.actor(req, "content:write");
      const { rel, row } = await loadArchive(pool, a, idParam(req));
      need(rel, RANK.editor);
      const body = parse(createBody, req.body);
      const item = await createItem(pool, row.id, a.userId, body);
      const loaded = await loadItem(pool, a, item.id);
      return reply.code(201).send(await itemDetail(pool, loaded.row, loaded.rel));
    });

    r.get("/v1/items/:id", async (req) => {
      const a = await ctx.actor(req, "content:read");
      const { rel, row } = await loadItem(pool, a, idParam(req));
      return itemDetail(pool, row, rel);
    });

    r.patch("/v1/items/:id", async (req) => {
      const a = await ctx.actor(req, "content:write");
      const { rel, row } = await loadItem(pool, a, idParam(req));
      need(rel, RANK.editor);
      const body = parse(patchBody, req.body);
      if (body.markdown !== undefined && row.kind !== "guide") throw new HttpError(400, "invalid_request", { issues: ["markdown: only guides have markdown"] });
      await tx(pool, async (c) => {
        const set: string[] = [];
        const vals: unknown[] = [];
        const add = (col: string, v: unknown) => {
          vals.push(v);
          set.push(`${col} = $${vals.length}`);
        };
        if (body.title !== undefined) add("title", body.title);
        if (body.summary !== undefined) add("summary", body.summary);
        if (body.order !== undefined) add("ord", body.order);
        if (body.status !== undefined) {
          add("status", body.status);
          // A person publishing AI drafted material has reviewed it.
          if (body.status === "published" && row.ai_status === "draft") add("ai_status", "reviewed");
        }
        if (set.length) {
          vals.push(row.id);
          await c.query(`UPDATE content.sub_items SET ${set.join(", ")}, updated_at = now() WHERE id = $${vals.length}`, vals);
        }
        if (body.markdown !== undefined) {
          const { rows } = await c.query("SELECT body FROM content.item_versions WHERE id = $1", [row.current_version_id]);
          if (rows[0]?.body.markdown !== body.markdown) await addVersion(c, row as any, { markdown: body.markdown }, a.userId, body.source, body.note);
        }
        await c.query("UPDATE content.master_items SET updated_at = now() WHERE id = $1", [row.master_item_id]);
      });
      const loaded = await loadItem(pool, a, row.id);
      return itemDetail(pool, loaded.row, loaded.rel);
    });

    r.delete("/v1/items/:id", async (req, reply) => {
      const a = await ctx.actor(req, "content:write");
      const { rel, row } = await loadItem(pool, a, idParam(req));
      need(rel, RANK.editor);
      await pool.query("UPDATE content.sub_items SET deleted_at = now() WHERE id = $1", [row.id]);
      return reply.code(204).send();
    });

    r.post("/v1/items/:id/restore", async (req) => {
      const a = await ctx.actor(req, "content:write");
      const { rel, row } = await loadItem(pool, a, idParam(req), { deleted: true });
      need(rel, RANK.editor);
      await pool.query("UPDATE content.sub_items SET deleted_at = NULL, updated_at = now() WHERE id = $1", [row.id]);
      return { restored: true };
    });

    // ---- versions --------------------------------------------------------
    r.get("/v1/items/:id/versions", async (req) => {
      const a = await ctx.actor(req, "content:read");
      const { rel, row } = await loadItem(pool, a, idParam(req));
      need(rel, RANK.viewer);
      const { rows } = await pool.query(
        "SELECT id, version_no, source, author_id, note, created_at, id = $2 AS current FROM content.item_versions WHERE sub_item_id = $1 ORDER BY version_no DESC",
        [row.id, row.current_version_id],
      );
      return rows.map((v) => ({ number: v.version_no, source: v.source, authorId: v.author_id, note: v.note, createdAt: v.created_at, current: v.current }));
    });

    r.get("/v1/items/:id/versions/:no", async (req) => {
      const a = await ctx.actor(req, "content:read");
      const { rel, row } = await loadItem(pool, a, idParam(req));
      need(rel, RANK.viewer);
      const no = Number((req.params as { no: string }).no);
      if (!Number.isInteger(no)) throw new HttpError(404, "not_found");
      const { rows } = await pool.query("SELECT version_no, body, source, author_id, note, created_at FROM content.item_versions WHERE sub_item_id = $1 AND version_no = $2", [row.id, no]);
      if (!rows[0]) throw new HttpError(404, "not_found");
      const v = rows[0];
      return { number: v.version_no, body: v.body, source: v.source, authorId: v.author_id, note: v.note, createdAt: v.created_at };
    });

    r.post("/v1/items/:id/versions/:no/restore", async (req) => {
      const a = await ctx.actor(req, "content:write");
      const { rel, row } = await loadItem(pool, a, idParam(req));
      need(rel, RANK.editor);
      const no = Number((req.params as { no: string }).no);
      const { rows } = await pool.query("SELECT body FROM content.item_versions WHERE sub_item_id = $1 AND version_no = $2", [row.id, Number.isInteger(no) ? no : -1]);
      if (!rows[0]) throw new HttpError(404, "not_found");
      const body = rows[0].body as { markdown?: string; cards?: Array<CardInput & { order?: number }> };
      const number = await tx(pool, async (c) => {
        if (row.kind === "deck") {
          const keep = (body.cards ?? []).map((x) => x.id).filter(Boolean) as string[];
          await c.query("DELETE FROM content.cards WHERE deck_id = $1 AND NOT (id = ANY($2::uuid[]))", [row.id, keep]);
          for (const [i, card] of (body.cards ?? []).entries()) {
            await c.query(
              `INSERT INTO content.cards (id, deck_id, ord, front, back, hint, tags) VALUES ($1,$2,$3,$4,$5,$6,$7)
               ON CONFLICT (id) DO UPDATE SET front = EXCLUDED.front, back = EXCLUDED.back, hint = EXCLUDED.hint, tags = EXCLUDED.tags, ord = EXCLUDED.ord, updated_at = now()`,
              [card.id ?? uuidv7(), row.id, i, card.front, card.back, card.hint ?? null, card.tags ?? []],
            );
          }
          return addVersion(c, row as any, await deckSnapshot(c, row.id), a.userId, "restore", `Restored version ${no}`);
        }
        return addVersion(c, row as any, { markdown: body.markdown ?? "" }, a.userId, "restore", `Restored version ${no}`);
      });
      return { version: number };
    });

    // ---- cards -----------------------------------------------------------
    async function deckFor(req: Parameters<typeof idParam>[0], scope: "content:read" | "content:write", min: number) {
      const a = await ctx.actor(req, scope);
      const loaded = await loadItem(pool, a, idParam(req));
      if (loaded.row.kind !== "deck") throw new HttpError(404, "not_found");
      need(loaded.rel, min);
      return { a, ...loaded };
    }

    r.get("/v1/items/:id/cards", async (req) => {
      const { row } = await deckFor(req, "content:read", RANK.viewer);
      return (await deckSnapshot(pool, row.id)).cards;
    });

    r.post("/v1/items/:id/cards", async (req, reply) => {
      const { a, row } = await deckFor(req, "content:write", RANK.editor);
      const body = parse(z.object({ cards: z.array(cardInput).min(1).max(500), source: source.default("human") }), req.body);
      const ids = await tx(pool, async (c) => {
        const ids = await upsertCards(c, row.id, body.cards);
        await addVersion(c, row as any, await deckSnapshot(c, row.id), a.userId, body.source);
        return ids;
      });
      return reply.code(201).send({ ids });
    });

    r.post("/v1/items/:id/cards/delete", async (req) => {
      const { a, row } = await deckFor(req, "content:write", RANK.editor);
      const body = parse(z.object({ ids: z.array(z.uuid()).min(1).max(500), source: source.default("human") }), req.body);
      const deleted = await tx(pool, async (c) => {
        const res = await c.query("DELETE FROM content.cards WHERE deck_id = $1 AND id = ANY($2::uuid[])", [row.id, body.ids]);
        if (res.rowCount) await addVersion(c, row as any, await deckSnapshot(c, row.id), a.userId, body.source);
        return res.rowCount ?? 0;
      });
      return { deleted };
    });

    r.patch("/v1/cards/:id", async (req) => {
      const a = await ctx.actor(req, "content:write");
      const { rows } = await pool.query("SELECT deck_id FROM content.cards WHERE id = $1", [idParam(req)]);
      if (!rows[0]) throw new HttpError(404, "not_found");
      const { rel, row } = await loadItem(pool, a, rows[0].deck_id);
      need(rel, RANK.editor);
      const body = parse(cardInput.partial().omit({ id: true }), req.body);
      await tx(pool, async (c) => {
        await c.query(
          "UPDATE content.cards SET front = coalesce($2, front), back = coalesce($3, back), hint = CASE WHEN $4::boolean THEN $5 ELSE hint END, tags = coalesce($6, tags), updated_at = now() WHERE id = $1",
          [idParam(req), body.front ?? null, body.back ?? null, body.hint !== undefined, body.hint ?? null, body.tags ?? null],
        );
        await addVersion(c, row as any, await deckSnapshot(c, row.id), a.userId, "human");
      });
      return { updated: true };
    });
  };
}
