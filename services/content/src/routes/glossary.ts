import { HttpError, idParam, parse, tx, uuidv7 } from "@ultimyr/service-kit";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { RANK, loadArchive, need, type Actor } from "../access.js";
import type { Ctx } from "../ctx.js";

const MAX_TERMS_PER_ARCHIVE = 2000;
const termIn = z.object({
  term: z.string().trim().min(1).max(100),
  expansion: z.string().trim().max(200).default(""),
  definition: z.string().trim().min(1).max(2000),
});
const putBody = z.object({
  terms: z.array(termIn).min(1).max(500),
  source: z.enum(["human", "ai", "mcp", "import"]).default("human"),
  status: z.enum(["draft", "published"]).optional(),
});
const listQuery = z.object({ q: z.string().trim().max(100).optional() });

type Row = Record<string, any>;
const out = (r: Row) => ({ id: r.id as string, term: r.term as string, expansion: r.expansion as string, definition: r.definition as string, status: r.status as string });

/** The glossary of a course: terms and acronyms with definitions. Readers see published terms; editors also see drafts. */
export function glossaryRoutes(ctx: Ctx) {
  const { pool } = ctx;
  const rel = async (a: Actor, archiveId: string) => {
    const r = (await loadArchive(pool, a, archiveId)).rel;
    need(r, RANK.viewer);
    return r;
  };

  return async (r: FastifyInstance) => {
    r.get("/v1/archives/:id/glossary", async (req) => {
      const a = await ctx.actor(req, "content:read");
      const id = idParam(req);
      const q = parse(listQuery, req.query);
      const editor = (await rel(a, id)) >= RANK.editor;
      const like = q.q ? `%${q.q.replace(/[\\%_]/g, "\\$&")}%` : null;
      const { rows } = await pool.query(
        `SELECT * FROM content.glossary_terms WHERE archive_id = $1 AND ($2 OR status = 'published')
            AND ($3::text IS NULL OR term ILIKE $3 OR expansion ILIKE $3 OR definition ILIKE $3)
          ORDER BY lower(term) LIMIT 2000`,
        [id, editor, like],
      );
      return { archiveId: id, canEdit: editor, terms: rows.map(out) };
    });

    /** Add or update terms by name (case does not matter). Existing terms keep their id. */
    r.put("/v1/archives/:id/glossary", async (req) => {
      const a = await ctx.actor(req, "content:write");
      const id = idParam(req);
      need((await loadArchive(pool, a, id)).rel, RANK.editor);
      const body = parse(putBody, req.body);
      const status = body.status ?? (body.source === "ai" || body.source === "mcp" ? "draft" : "published");
      let added = 0;
      let updated = 0;
      await tx(pool, async (c) => {
        const { rows: n } = await c.query("SELECT count(*)::int AS n FROM content.glossary_terms WHERE archive_id = $1", [id]);
        const seen = new Set<string>();
        for (const t of body.terms) {
          const key = t.term.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          const { rows } = await c.query(
            `INSERT INTO content.glossary_terms (id, archive_id, term, expansion, definition, status, source) VALUES ($1,$2,$3,$4,$5,$6,$7)
             ON CONFLICT (archive_id, lower(term)) DO UPDATE SET term = $3, expansion = $4, definition = $5, status = $6, source = $7, updated_at = now()
             RETURNING (xmax = 0) AS inserted`,
            [uuidv7(), id, t.term, t.expansion, t.definition, status, body.source],
          );
          if (rows[0].inserted) added++;
          else updated++;
        }
        if (n[0].n + added > MAX_TERMS_PER_ARCHIVE) throw new HttpError(400, "invalid_request", { issues: [`a glossary holds at most ${MAX_TERMS_PER_ARCHIVE} terms`] });
      });
      return { added, updated };
    });

    r.delete("/v1/archives/:id/glossary/:termId", async (req, reply) => {
      const a = await ctx.actor(req, "content:write");
      const id = idParam(req);
      const termId = idParam(req, "termId");
      need((await loadArchive(pool, a, id)).rel, RANK.editor);
      const { rowCount } = await pool.query("DELETE FROM content.glossary_terms WHERE id = $1 AND archive_id = $2", [termId, id]);
      if (!rowCount) throw new HttpError(404, "not_found");
      return reply.code(204).send();
    });

    /** Publish every draft term in the course. */
    r.post("/v1/archives/:id/glossary/publish", async (req) => {
      const a = await ctx.actor(req, "content:write");
      const id = idParam(req);
      need((await loadArchive(pool, a, id)).rel, RANK.editor);
      const { rowCount } = await pool.query("UPDATE content.glossary_terms SET status = 'published', updated_at = now() WHERE archive_id = $1 AND status = 'draft'", [id]);
      return { published: rowCount ?? 0 };
    });
  };
}
