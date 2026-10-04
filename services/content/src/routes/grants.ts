import { HttpError, idParam, parse, uuidv7 } from "@ultimyr/service-kit";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { ARCHIVE_REL, ITEM_GRANT, RANK, RELATION_BY_RANK, loadArchive, loadItem, need } from "../access.js";
import type { Ctx } from "../ctx.js";

const MAX_GRANTS_PER_OBJECT = 500;
const grantBody = z.object({
  subjectType: z.enum(["user", "group"]),
  subjectId: z.uuid(),
  relation: z.enum(["attempt", "viewer", "editor", "owner"]),
  expiresAt: z.iso.datetime().nullable().optional(),
});

const out = (g: Record<string, any>) => ({
  id: g.id,
  subjectType: g.subject_type,
  subjectId: g.subject_id,
  relation: g.relation,
  expiresAt: g.expires_at,
  createdBy: g.created_by,
  createdAt: g.created_at,
});

export function grantRoutes(ctx: Ctx) {
  const { pool } = ctx;

  /** Resolve the object a grant route targets and make sure the caller owns it. */
  async function target(req: FastifyRequest, scope: "content:read" | "content:share") {
    const a = await ctx.actor(req, scope);
    const isArchive = req.url.split("?")[0]!.includes("/archives/");
    const id = idParam(req);
    if (isArchive) {
      const { rel } = await loadArchive(pool, a, id);
      need(rel, RANK.owner);
      return { a, type: "archive" as const, id };
    }
    const { rel } = await loadItem(pool, a, id);
    need(rel, RANK.owner);
    return { a, type: "item" as const, id };
  }

  return async (r: FastifyInstance) => {
    for (const base of ["/v1/archives/:id/grants", "/v1/items/:id/grants"]) {
      r.get(base, async (req) => {
        const t = await target(req, "content:read");
        const { rows } = await pool.query("SELECT * FROM content.grants WHERE object_type = $1 AND object_id = $2 ORDER BY created_at", [t.type, t.id]);
        return rows.map(out);
      });

      r.post(base, async (req, reply) => {
        const t = await target(req, "content:share");
        const body = parse(grantBody, req.body);
        if (body.subjectType === "user" && body.subjectId === t.a.userId) throw new HttpError(400, "invalid_request", { issues: ["subjectId: you already own this"] });
        const expires = body.expiresAt ? new Date(body.expiresAt) : null;
        if (expires && expires <= new Date()) throw new HttpError(400, "invalid_request", { issues: ["expiresAt: must be in the future"] });
        const { rows: cnt } = await pool.query("SELECT count(*)::int AS n FROM content.grants WHERE object_type = $1 AND object_id = $2", [t.type, t.id]);
        if (cnt[0].n >= MAX_GRANTS_PER_OBJECT) throw new HttpError(409, "too_many_grants", { max: MAX_GRANTS_PER_OBJECT });
        const { rows } = await pool.query(
          `INSERT INTO content.grants (id, object_type, object_id, subject_type, subject_id, relation, created_by, expires_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (object_type, object_id, subject_type, subject_id, relation) DO UPDATE SET expires_at = EXCLUDED.expires_at
           RETURNING *`,
          [uuidv7(), t.type, t.id, body.subjectType, body.subjectId, body.relation, t.a.userId, expires],
        );
        return reply.code(201).send(out(rows[0]!));
      });

      r.delete(`${base}/:grantId`, async (req, reply) => {
        const t = await target(req, "content:share");
        const res = await pool.query("DELETE FROM content.grants WHERE id = $1 AND object_type = $2 AND object_id = $3", [idParam(req, "grantId"), t.type, t.id]);
        if (!res.rowCount) throw new HttpError(404, "not_found");
        return reply.code(204).send();
      });
    }

    // What can the caller do with this object? Used by other services (quiz) to authorise their own requests.
    r.get("/v1/access/:type/:id", async (req) => {
      const principal = await ctx.svc.authenticate(req);
      const bearer = req.headers.authorization!.slice(7);
      const a = { userId: principal.userId, principal, groups: await ctx.groups.groupsFor(principal, bearer) };
      const { type } = req.params as { type: string };
      let rel: number;
      let extra: Record<string, unknown> = {};
      if (type === "archive") {
        const archiveId = idParam(req);
        const arc = await loadArchive(pool, a, archiveId);
        rel = arc.rel;
        // The quizzes inside it the caller may attempt, so the quiz service can build practice sets across them.
        const { rows: qs } = await pool.query(
          `SELECT s.id, s.status, s.title, GREATEST($4::int, ${ITEM_GRANT}) AS rel FROM content.sub_items s
            WHERE s.master_item_id = $3 AND s.kind = 'quiz' AND s.deleted_at IS NULL`,
          [a.userId, a.groups, archiveId, rel],
        );
        extra = {
          quizzes: qs
            .filter((q) => Number(q.rel) >= RANK.attempt && (q.status === "published" || Number(q.rel) >= RANK.editor))
            .map((q) => ({ id: q.id, title: q.title, status: q.status, canAttempt: true, canWrite: Number(q.rel) >= RANK.editor })),
        };
      } else if (type === "item") {
        const it = await loadItem(pool, a, idParam(req));
        rel = it.rel;
        extra = { kind: it.row.kind, archiveId: it.row.master_item_id, status: it.row.status, archiveOwnerId: it.archive.ownerId };
      } else throw new HttpError(404, "not_found");
      return {
        relation: RELATION_BY_RANK[Math.min(rel, 4)],
        canRead: rel >= RANK.viewer,
        canAttempt: rel >= RANK.attempt,
        canWrite: rel >= RANK.editor,
        canShare: rel >= RANK.owner,
        ...extra,
      };
    });
  };
}

void ARCHIVE_REL;
void ITEM_GRANT;
