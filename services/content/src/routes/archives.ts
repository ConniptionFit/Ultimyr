import { HttpError, idParam, pageQuery, parse, uuidv7, type Pool } from "@ultimyr/service-kit";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { ARCHIVE_REL, ITEM_GRANT, RANK, RELATION_BY_RANK, isCurator, loadArchive, need } from "../access.js";
import type { Ctx } from "../ctx.js";
import { cleanIconPng } from "../png.js";
import { refreshIcons } from "../tagging.js";
import { hasIcon, DEFAULT_ICON } from "@ultimyr/tagging";

const httpUrl = z.url().refine((u) => /^https?:\/\//i.test(u), "must be http or https");
const quickStats = z.object({
  passingScore: z.string().max(40).optional(),
  durationMinutes: z.number().int().min(1).max(1440).optional(),
  questionCount: z.number().int().min(1).max(10_000).optional(),
  costUsd: z.number().min(0).max(100_000).optional(),
  difficulty: z.enum(["beginner", "intermediate", "advanced", "expert"]).optional(),
});
const fields = {
  title: z.string().trim().min(1).max(120),
  overview: z.string().max(10_000),
  vendor: z.string().trim().max(120).nullable(),
  purchaseLinks: z.array(z.object({ label: z.string().trim().min(1).max(80), url: httpUrl })).max(10),
  validityMonths: z.number().int().min(1).max(600).nullable(),
  quickStats,
  iconName: z.string().regex(/^[a-z0-9-]{1,60}$/, "a Lucide icon name such as book-open").refine(hasIcon, "not in the Lucide icon library"),
  visibility: z.enum(["private", "shared", "org", "public"]),
  tags: z.array(z.string().trim().min(1).max(40)).max(20),
  scoringProfileId: z.uuid().nullable(),
};
const createBody = z.object({ ...fields, overview: fields.overview.default(""), slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,58}[a-z0-9]$/).optional() }).partial({
  vendor: true,
  purchaseLinks: true,
  validityMonths: true,
  quickStats: true,
  iconName: true,
  visibility: true,
  tags: true,
  scoringProfileId: true,
});
const patchBody = z.object({ ...fields, iconName: fields.iconName.nullable() }).partial();
const listQuery = pageQuery.extend({ q: z.string().trim().max(200).optional(), scope: z.enum(["all", "mine", "shared"]).default("all") });

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50) || "archive";

export function archiveOut(row: Record<string, any>, rel: number) {
  return {
    id: row.id,
    ownerId: row.owner_id,
    slug: row.slug,
    title: row.title,
    overview: row.overview,
    vendor: row.vendor,
    purchaseLinks: row.purchase_links,
    validityMonths: row.validity_months,
    quickStats: row.quick_stats,
    icon: { kind: row.icon_kind, name: row.icon_name, source: row.icon_source, assetId: row.icon_asset_id, url: row.icon_asset_id ? `/api/v1/assets/${row.icon_asset_id}` : null },
    visibility: row.visibility,
    scoringProfileId: row.scoring_profile_id,
    tags: row.tags,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at ?? null,
    relation: RELATION_BY_RANK[Math.min(rel, 4)],
  };
}

async function uniqueSlug(pool: Pool, ownerId: string, base: string): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const s = i === 0 ? base : `${base}-${i + 1}`;
    const { rowCount } = await pool.query("SELECT 1 FROM content.master_items WHERE owner_id = $1 AND slug = $2", [ownerId, s]);
    if (!rowCount) return s;
  }
  return `${base}-${uuidv7().slice(-6)}`;
}

/** Create an archive. Shared by the REST route and import. */
export async function createArchive(pool: Pool, ownerId: string, body: z.infer<typeof createBody>) {
  const id = uuidv7();
  const slug = await uniqueSlug(pool, ownerId, body.slug ?? slugify(body.title));
  const { rows } = await pool.query(
    `INSERT INTO content.master_items (id, owner_id, slug, title, overview, vendor, purchase_links, validity_months, quick_stats, icon_name, visibility, tags, scoring_profile_id, icon_source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [
      id,
      ownerId,
      slug,
      body.title,
      body.overview ?? "",
      body.vendor ?? null,
      JSON.stringify(body.purchaseLinks ?? []),
      body.validityMonths ?? null,
      JSON.stringify(body.quickStats ?? {}),
      body.iconName ?? DEFAULT_ICON,
      body.visibility ?? "private",
      body.tags ?? [],
      body.scoringProfileId ?? null,
      body.iconName ? "user" : "default",
    ],
  );
  return rows[0]!;
}
export { createBody as createArchiveBody };

export function archiveRoutes(ctx: Ctx) {
  const { pool } = ctx;
  return async (r: FastifyInstance) => {
    // Raw PNG uploads for icons.
    r.addContentTypeParser("image/png", { parseAs: "buffer", bodyLimit: 600 * 1024 }, (_req, body, done) => done(null, body));

    r.get("/v1/archives", async (req) => {
      const a = await ctx.actor(req, "content:read");
      const q = parse(listQuery, req.query);
      const { rows } = await pool.query(
        `SELECT * FROM (
           SELECT m.*, ${ARCHIVE_REL} AS rel,
                  EXISTS (SELECT 1 FROM content.sub_items s WHERE s.master_item_id = m.id AND s.deleted_at IS NULL AND s.status = 'published' AND ${ITEM_GRANT} >= 1) AS item_lent,
                  (SELECT count(*)::int FROM content.sub_items s WHERE s.master_item_id = m.id AND s.deleted_at IS NULL AND (s.status = 'published' OR m.owner_id = $1)) AS item_count
             FROM content.master_items m WHERE m.deleted_at IS NULL
         ) t
         WHERE (rel >= 2 OR item_lent)
           AND ($5::text IS NULL OR search @@ websearch_to_tsquery('english', $5) OR title ILIKE '%' || $5 || '%')
           AND CASE $6::text WHEN 'mine' THEN owner_id = $1 WHEN 'shared' THEN owner_id <> $1 ELSE true END
         ORDER BY updated_at DESC, id LIMIT $3 OFFSET $4`,
        [a.userId, a.groups, q.limit, q.offset, q.q ?? null, q.scope],
      );
      return { archives: rows.map((x) => ({ ...archiveOut(x, Number(x.rel)), itemCount: x.item_count })), limit: q.limit, offset: q.offset };
    });

    r.post("/v1/archives", async (req, reply) => {
      const a = await ctx.actor(req, "content:write");
      ctx.requireAuthor(a);
      const body = parse(createBody, req.body);
      const created = await createArchive(pool, a.userId, body);
      const row = (await refreshIcons(pool, created.id)) ?? created;
      return reply.code(201).send(archiveOut(row, RANK.owner));
    });

    r.get("/v1/archives/:id", async (req) => {
      const a = await ctx.actor(req, "content:read");
      const { rel, metaRel, row } = await loadArchive(pool, a, idParam(req));
      const { rows: items } = await pool.query(
        `SELECT * FROM (
           SELECT s.*, GREATEST($4::int, ${ITEM_GRANT}) AS irel FROM content.sub_items s WHERE s.master_item_id = $3 AND s.deleted_at IS NULL
         ) s WHERE irel >= 1 AND (status = 'published' OR irel >= 3) AND (kind = 'quiz' OR irel >= 2)
         ORDER BY ord, created_at`,
        [a.userId, a.groups, row.id, rel],
      );
      return {
        ...archiveOut(row, metaRel),
        items: items.map((s) => itemSummary(s, Number(s.irel))),
      };
    });

    r.patch("/v1/archives/:id", async (req) => {
      const a = await ctx.actor(req, "content:write");
      const { rel, row } = await loadArchive(pool, a, idParam(req));
      need(rel, RANK.editor);
      const body = parse(patchBody, req.body);
      if (body.visibility && body.visibility !== row.visibility) need(rel, RANK.owner);
      const set: string[] = [];
      const vals: unknown[] = [];
      const add = (col: string, v: unknown) => {
        vals.push(v);
        set.push(`${col} = $${vals.length}`);
      };
      if (body.title !== undefined) add("title", body.title);
      if (body.overview !== undefined) add("overview", body.overview);
      if (body.vendor !== undefined) add("vendor", body.vendor);
      if (body.purchaseLinks !== undefined) add("purchase_links", JSON.stringify(body.purchaseLinks));
      if (body.validityMonths !== undefined) add("validity_months", body.validityMonths);
      if (body.quickStats !== undefined) add("quick_stats", JSON.stringify(body.quickStats));
      if (body.iconName !== undefined) {
        // A name is a person's own choice and is never replaced automatically; null hands the icon back to automatic assignment.
        add("icon_name", body.iconName ?? DEFAULT_ICON);
        add("icon_kind", "lucide");
        add("icon_asset_id", null);
        add("icon_source", body.iconName === null ? "default" : "user");
      }
      if (body.visibility !== undefined) add("visibility", body.visibility);
      if (body.tags !== undefined) add("tags", body.tags);
      if (body.scoringProfileId !== undefined) add("scoring_profile_id", body.scoringProfileId);
      if (!set.length) return archiveOut(row, rel);
      vals.push(row.id);
      const { rows } = await pool.query(`UPDATE content.master_items SET ${set.join(", ")}, updated_at = now() WHERE id = $${vals.length} RETURNING *`, vals);
      const retag = body.title !== undefined || body.overview !== undefined || body.tags !== undefined || body.iconName === null;
      const fresh = retag ? await refreshIcons(pool, row.id) : null;
      return archiveOut(fresh ?? rows[0]!, rel);
    });

    // Deleting is recoverable for 30 days (see purge in main.ts).
    r.delete("/v1/archives/:id", async (req, reply) => {
      const a = await ctx.actor(req, "content:write");
      const { rel, row } = await loadArchive(pool, a, idParam(req));
      need(rel, RANK.owner);
      await pool.query("UPDATE content.master_items SET deleted_at = now() WHERE id = $1", [row.id]);
      return reply.code(204).send();
    });

    r.get("/v1/trash", async (req) => {
      const a = await ctx.actor(req, "content:read");
      const { rows: archives } = await pool.query("SELECT * FROM content.master_items WHERE ($2::boolean OR owner_id = $1) AND deleted_at IS NOT NULL ORDER BY deleted_at DESC", [a.userId, isCurator(a)]);
      const { rows: items } = await pool.query(
        `SELECT s.* FROM content.sub_items s JOIN content.master_items m ON m.id = s.master_item_id AND m.deleted_at IS NULL
          WHERE ($2::boolean OR s.owner_id = $1) AND s.deleted_at IS NOT NULL ORDER BY s.deleted_at DESC`,
        [a.userId, isCurator(a)],
      );
      return { archives: archives.map((x) => archiveOut(x, RANK.owner)), items: items.map((s) => ({ ...itemSummary(s, RANK.owner), deletedAt: s.deleted_at })) };
    });

    r.post("/v1/archives/:id/restore", async (req) => {
      const a = await ctx.actor(req, "content:write");
      const { rel, row } = await loadArchive(pool, a, idParam(req), { deleted: true });
      need(rel, RANK.owner);
      await pool.query("UPDATE content.master_items SET deleted_at = NULL, updated_at = now() WHERE id = $1", [row.id]);
      return { restored: true };
    });

    // ---- icons -----------------------------------------------------------
    r.post("/v1/archives/:id/icon", async (req) => {
      const a = await ctx.actor(req, "content:write");
      const { rel, row } = await loadArchive(pool, a, idParam(req));
      need(rel, RANK.editor);
      if (req.headers["content-type"]?.split(";")[0] !== "image/png" || !Buffer.isBuffer(req.body)) throw new HttpError(415, "icon_not_png");
      const png = cleanIconPng(req.body);
      const assetId = uuidv7();
      await pool.query("INSERT INTO content.assets (id, owner_id, kind, mime, bytes, sha256, width, height) VALUES ($1,$2,'icon','image/png',$3,$4,$5,$6)", [
        assetId,
        a.userId,
        png.bytes,
        png.sha256,
        png.width,
        png.height,
      ]);
      await pool.query("UPDATE content.master_items SET icon_kind = 'upload', icon_asset_id = $1, icon_source = 'user', updated_at = now() WHERE id = $2", [assetId, row.id]);
      await pool.query("DELETE FROM content.assets a WHERE a.owner_id = $1 AND a.kind = 'icon' AND a.id <> $2 AND NOT EXISTS (SELECT 1 FROM content.master_items m WHERE m.icon_asset_id = a.id)", [a.userId, assetId]);
      return { assetId, url: `/api/v1/assets/${assetId}`, width: png.width, height: png.height };
    });

    r.delete("/v1/archives/:id/icon", async (req, reply) => {
      const a = await ctx.actor(req, "content:write");
      const { rel, row } = await loadArchive(pool, a, idParam(req));
      need(rel, RANK.editor);
      await pool.query("UPDATE content.master_items SET icon_kind = 'lucide', icon_asset_id = NULL, icon_name = $2, icon_source = 'default', updated_at = now() WHERE id = $1", [row.id, DEFAULT_ICON]);
      await refreshIcons(pool, row.id);
      return reply.code(204).send();
    });

    // Icons are referenced by unguessable ids from <img> tags, which cannot send a bearer token.
    r.get("/v1/assets/:id", async (req, reply) => {
      const { rows } = await pool.query("SELECT mime, bytes, sha256 FROM content.assets WHERE id = $1", [idParam(req)]);
      const row = rows[0];
      if (!row) throw new HttpError(404, "not_found");
      return reply
        .header("content-type", row.mime)
        .header("cache-control", "public, max-age=31536000, immutable")
        .header("x-content-type-options", "nosniff")
        .header("content-security-policy", "default-src 'none'")
        .header("etag", `"${row.sha256}"`)
        .send(row.bytes);
    });
  };
}

export function itemSummary(s: Record<string, any>, rel: number) {
  return {
    id: s.id,
    archiveId: s.master_item_id,
    kind: s.kind,
    title: s.title,
    summary: s.summary,
    status: s.status,
    aiStatus: s.ai_status,
    ownerId: s.owner_id,
    order: s.ord,
    createdAt: s.created_at,
    updatedAt: s.updated_at,
    relation: RELATION_BY_RANK[Math.min(rel, 4)],
  };
}

export type { FastifyRequest };
