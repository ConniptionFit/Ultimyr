import { idParam, pageQuery, parse } from "@ultimyr/service-kit";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ARCHIVE_REL, ITEM_GRANT } from "../access.js";
import type { Ctx } from "../ctx.js";

const query = pageQuery.extend({
  q: z.string().trim().min(1).max(200),
  archive: z.uuid().optional(),
  type: z.enum(["archive", "item", "section", "card", "resource"]).optional(),
});

export function searchRoutes(ctx: Ctx) {
  const { pool } = ctx;
  return async (r: FastifyInstance) => {
    r.get("/v1/search", async (req) => {
      const a = await ctx.actor(req, "content:read");
      const q = parse(query, req.query);
      // Only material the caller can already read is searched: archives and items, guide sections of the current version, and cards.
      const { rows } = await pool.query(
        `WITH tq AS (SELECT websearch_to_tsquery('english', $3) AS q),
         acc AS (SELECT m.*, ${ARCHIVE_REL} AS rel FROM content.master_items m WHERE m.deleted_at IS NULL AND ($4::uuid IS NULL OR m.id = $4)),
         vis AS (
           SELECT s.*, acc.title AS archive_title FROM (
             SELECT s.*, GREATEST((SELECT rel FROM acc WHERE acc.id = s.master_item_id), ${ITEM_GRANT}) AS irel
               FROM content.sub_items s WHERE s.deleted_at IS NULL AND s.master_item_id IN (SELECT id FROM acc)
           ) s JOIN acc ON acc.id = s.master_item_id
           WHERE (s.irel >= 2 OR (s.kind = 'quiz' AND s.irel >= 1)) AND (s.status = 'published' OR s.irel >= 3)
         )
         SELECT * FROM (
           SELECT 'archive' AS type, acc.id, acc.id AS archive_id, NULL::uuid AS item_id, acc.title, ts_headline('english', acc.overview, tq.q, 'MaxFragments=1,MaxWords=24,MinWords=8') AS snippet, ts_rank(acc.search, tq.q) AS score, NULL::text AS anchor, NULL::text AS url
             FROM acc, tq WHERE acc.rel >= 2 AND acc.search @@ tq.q
           UNION ALL
           SELECT 'item', vis.id, vis.master_item_id, vis.id, vis.title, ts_headline('english', vis.summary, tq.q, 'MaxFragments=1,MaxWords=24,MinWords=8'), ts_rank(vis.search, tq.q), NULL, NULL
             FROM vis, tq WHERE vis.search @@ tq.q
           UNION ALL
           SELECT 'section', vis.id, vis.master_item_id, vis.id, vis.title || ' › ' || gs.heading, ts_headline('english', gs.md_body, tq.q, 'MaxFragments=1,MaxWords=30,MinWords=10'), ts_rank(gs.search, tq.q), gs.anchor, NULL
             FROM vis JOIN content.guide_sections gs ON gs.version_id = vis.current_version_id, tq WHERE vis.irel >= 2 AND gs.search @@ tq.q
           UNION ALL
           SELECT 'card', c.id, vis.master_item_id, vis.id, vis.title || ' › ' || left(c.front, 80), ts_headline('english', c.back, tq.q, 'MaxFragments=1,MaxWords=24,MinWords=8'), ts_rank(c.search, tq.q), NULL, NULL
             FROM vis JOIN content.cards c ON c.deck_id = vis.id, tq WHERE vis.irel >= 2 AND c.search @@ tq.q
           UNION ALL
           SELECT 'resource', rs.id, rs.master_item_id, NULL, rs.title, ts_headline('english', rs.summary, tq.q, 'MaxFragments=1,MaxWords=24,MinWords=8'), ts_rank(rs.search, tq.q), NULL, rs.url
             FROM content.resources rs JOIN acc ON acc.id = rs.master_item_id, tq
            WHERE acc.rel >= 2 AND rs.deleted_at IS NULL AND (rs.status = 'published' OR acc.rel >= 3) AND rs.search @@ tq.q
         ) res
         WHERE ($7::text IS NULL OR type = $7)
         ORDER BY score DESC, title LIMIT $5 OFFSET $6`,
        [a.userId, a.groups, q.q, q.archive ?? null, q.limit, q.offset, q.type ?? null],
      );
      return {
        results: rows.map((x) => ({ type: x.type, id: x.id, archiveId: x.archive_id, itemId: x.item_id, title: x.title, snippet: x.snippet, anchor: x.anchor, url: x.url, score: Number(x.score) })),
        limit: q.limit,
        offset: q.offset,
      };
    });
  };
}

void idParam;
