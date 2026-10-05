import { hasRole } from "@ultimyr/authz";
import { HttpError, idParam, parse, uuidv7 } from "@ultimyr/service-kit";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Actor } from "../access.js";
import type { Ctx } from "../ctx.js";

/** Group access levels as the admin panel names them. `view` is the viewer relation, `manage` is editor. */
const LEVEL_RELATION = { view: "viewer", manage: "editor" } as const;
type Level = keyof typeof LEVEL_RELATION;
const levelOf = (relation: string): Level | "attempt" | "owner" => (relation === "viewer" ? "view" : relation === "editor" ? "manage" : (relation as "attempt" | "owner"));
const MANAGED_RELATIONS = ["attempt", "viewer", "editor", "owner"];

const setLevel = z.object({ level: z.enum(["none", "view", "manage"]), expiresAt: z.iso.datetime().nullable().optional() });
const setMode = z.object({ mode: z.enum(["everyone", "restricted"]) });
const addDelegate = z.object({ userId: z.uuid() });

const isAdmin = (a: Actor) => hasRole(a.principal, "platform_admin");

/**
 * Group access: a central place to say which groups (including SCIM groups) may see or manage which archives.
 * Administrators manage every archive. People with the access_delegate role manage group access only for the
 * archives an administrator delegated to them, and cannot change who sees an archive at all or delegate onwards.
 */
export function groupAccessRoutes(ctx: Ctx) {
  const { pool } = ctx;

  async function caller(req: FastifyRequest, scope: "content:read" | "content:share") {
    const a = await ctx.actor(req, scope);
    if (!isAdmin(a) && !hasRole(a.principal, "access_delegate")) throw new HttpError(403, "forbidden");
    return a;
  }

  /** The archive, if it exists and the caller may manage its group access. Everything else answers 404. */
  async function managed(a: Actor, archiveId: string) {
    const { rows } = await pool.query(
      `SELECT m.id, m.title, m.visibility FROM content.master_items m
        WHERE m.id = $1 AND m.deleted_at IS NULL
          AND ($2::boolean OR EXISTS (SELECT 1 FROM content.access_delegations d WHERE d.archive_id = m.id AND d.user_id = $3))`,
      [archiveId, isAdmin(a), a.userId],
    );
    if (!rows[0]) throw new HttpError(404, "not_found");
    return rows[0] as { id: string; title: string; visibility: string };
  }

  const mode = (visibility: string) => (visibility === "org" || visibility === "public" ? "everyone" : "restricted");

  return async (r: FastifyInstance) => {
    // What the caller may manage: every archive for admins, the delegated ones for delegates.
    r.get("/v1/group-access/archives", async (req) => {
      const a = await caller(req, "content:read");
      const { rows } = await pool.query(
        `SELECT m.id, m.title, m.visibility,
                (SELECT count(*)::int FROM content.grants g WHERE g.object_type = 'archive' AND g.object_id = m.id AND g.subject_type = 'group') AS group_grants
           FROM content.master_items m
          WHERE m.deleted_at IS NULL
            AND ($1::boolean OR EXISTS (SELECT 1 FROM content.access_delegations d WHERE d.archive_id = m.id AND d.user_id = $2))
          ORDER BY lower(m.title) LIMIT 1000`,
        [isAdmin(a), a.userId],
      );
      return rows.map((m) => ({ id: m.id, title: m.title, visibility: m.visibility, access: mode(m.visibility), groupGrants: m.group_grants }));
    });

    // One group's level on every archive the caller manages.
    r.get("/v1/group-access/groups/:id", async (req) => {
      const a = await caller(req, "content:read");
      const groupId = idParam(req);
      const { rows } = await pool.query(
        `SELECT m.id, m.title, m.visibility,
                (SELECT g.relation FROM content.grants g
                  WHERE g.object_type = 'archive' AND g.object_id = m.id AND g.subject_type = 'group' AND g.subject_id = $1
                  ORDER BY g.rank DESC LIMIT 1) AS relation,
                (SELECT g.expires_at FROM content.grants g
                  WHERE g.object_type = 'archive' AND g.object_id = m.id AND g.subject_type = 'group' AND g.subject_id = $1
                  ORDER BY g.rank DESC LIMIT 1) AS expires_at
           FROM content.master_items m
          WHERE m.deleted_at IS NULL
            AND ($2::boolean OR EXISTS (SELECT 1 FROM content.access_delegations d WHERE d.archive_id = m.id AND d.user_id = $3))
          ORDER BY lower(m.title) LIMIT 1000`,
        [groupId, isAdmin(a), a.userId],
      );
      return rows.map((m) => ({
        archiveId: m.id,
        title: m.title,
        visibility: m.visibility,
        access: mode(m.visibility),
        level: m.relation ? levelOf(m.relation) : "none",
        expiresAt: m.expires_at,
      }));
    });

    // Set one group's level on one archive: none removes it, view and manage replace whatever it had.
    r.put("/v1/group-access/archives/:id/groups/:groupId", async (req) => {
      const a = await caller(req, "content:share");
      const archive = await managed(a, idParam(req));
      const groupId = idParam(req, "groupId");
      const body = parse(setLevel, req.body);
      const expires = body.expiresAt ? new Date(body.expiresAt) : null;
      if (expires && expires <= ctx.now()) throw new HttpError(400, "invalid_request", { issues: ["expiresAt: must be in the future"] });
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const { rows: held } = await client.query(
          "SELECT relation FROM content.grants WHERE object_type = 'archive' AND object_id = $1 AND subject_type = 'group' AND subject_id = $2 FOR UPDATE",
          [archive.id, groupId],
        );
        // Delegates may not touch an owner level grant an owner or administrator gave.
        if (!isAdmin(a) && held.some((h) => h.relation === "owner")) throw new HttpError(403, "forbidden");
        await client.query(
          "DELETE FROM content.grants WHERE object_type = 'archive' AND object_id = $1 AND subject_type = 'group' AND subject_id = $2 AND relation = ANY($3::text[])",
          [archive.id, groupId, MANAGED_RELATIONS],
        );
        if (body.level !== "none") {
          const { rows: cnt } = await client.query("SELECT count(*)::int AS n FROM content.grants WHERE object_type = 'archive' AND object_id = $1", [archive.id]);
          if (cnt[0].n >= 500) throw new HttpError(409, "too_many_grants", { max: 500 });
          await client.query(
            `INSERT INTO content.grants (id, object_type, object_id, subject_type, subject_id, relation, created_by, expires_at)
             VALUES ($1,'archive',$2,'group',$3,$4,$5,$6)`,
            [uuidv7(), archive.id, groupId, LEVEL_RELATION[body.level as Level], a.userId, expires],
          );
        }
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        throw e;
      } finally {
        client.release();
      }
      return { archiveId: archive.id, groupId, level: body.level, expiresAt: expires };
    });

    // Who can see the archive without a grant. Administrators only: delegates manage groups, not visibility.
    r.put("/v1/group-access/archives/:id/access", async (req) => {
      const a = await caller(req, "content:share");
      if (!isAdmin(a)) throw new HttpError(403, "forbidden");
      const archive = await managed(a, idParam(req));
      const body = parse(setMode, req.body);
      // Already in the requested mode: leave the exact visibility (private, shared, org, public) alone.
      const visibility = mode(archive.visibility) === body.mode ? archive.visibility : body.mode === "everyone" ? "org" : "shared";
      if (visibility !== archive.visibility) await pool.query("UPDATE content.master_items SET visibility = $2, updated_at = now() WHERE id = $1", [archive.id, visibility]);
      return { archiveId: archive.id, access: body.mode, visibility };
    });

    // Delegates: the people who may manage group access for one archive. Administrators only.
    r.get("/v1/group-access/archives/:id/delegates", async (req) => {
      const a = await caller(req, "content:read");
      if (!isAdmin(a)) throw new HttpError(403, "forbidden");
      const archive = await managed(a, idParam(req));
      const { rows } = await pool.query("SELECT user_id, created_by, created_at FROM content.access_delegations WHERE archive_id = $1 ORDER BY created_at", [archive.id]);
      return rows.map((d) => ({ userId: d.user_id, createdBy: d.created_by, createdAt: d.created_at }));
    });

    r.post("/v1/group-access/archives/:id/delegates", async (req, reply) => {
      const a = await caller(req, "content:share");
      if (!isAdmin(a)) throw new HttpError(403, "forbidden");
      const archive = await managed(a, idParam(req));
      const body = parse(addDelegate, req.body);
      const { rows: cnt } = await pool.query("SELECT count(*)::int AS n FROM content.access_delegations WHERE archive_id = $1", [archive.id]);
      if (cnt[0].n >= 100) throw new HttpError(409, "too_many_delegates", { max: 100 });
      await pool.query("INSERT INTO content.access_delegations (archive_id, user_id, created_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [archive.id, body.userId, a.userId]);
      return reply.code(201).send({ userId: body.userId });
    });

    r.delete("/v1/group-access/archives/:id/delegates/:userId", async (req, reply) => {
      const a = await caller(req, "content:share");
      if (!isAdmin(a)) throw new HttpError(403, "forbidden");
      const archive = await managed(a, idParam(req));
      const res = await pool.query("DELETE FROM content.access_delegations WHERE archive_id = $1 AND user_id = $2", [archive.id, idParam(req, "userId")]);
      if (!res.rowCount) throw new HttpError(404, "not_found");
      return reply.code(204).send();
    });

    // Archives delegated to one person, for the admin panel's per-person view.
    r.get("/v1/group-access/delegates/:userId", async (req) => {
      const a = await caller(req, "content:read");
      if (!isAdmin(a)) throw new HttpError(403, "forbidden");
      const { rows } = await pool.query(
        `SELECT m.id, m.title FROM content.access_delegations d JOIN content.master_items m ON m.id = d.archive_id AND m.deleted_at IS NULL
          WHERE d.user_id = $1 ORDER BY lower(m.title)`,
        [idParam(req, "userId")],
      );
      return rows.map((m) => ({ archiveId: m.id, title: m.title }));
    });
  };
}
