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

/** Administrators and curriculum admins manage group access for every archive. */
const canManage = (a: Actor) => hasRole(a.principal, "platform_admin", "curriculum_admin");

/** Group access: a central place to say which groups (including SCIM groups) may see or manage which archives. */
export function groupAccessRoutes(ctx: Ctx) {
  const { pool } = ctx;

  async function caller(req: FastifyRequest, scope: "content:read" | "content:share") {
    const a = await ctx.actor(req, scope);
    if (!canManage(a)) throw new HttpError(403, "forbidden");
    return a;
  }

  /** The archive, if it exists. Unknown and deleted archives answer 404. */
  async function managed(_a: Actor, archiveId: string) {
    const { rows } = await pool.query("SELECT m.id, m.title, m.visibility FROM content.master_items m WHERE m.id = $1 AND m.deleted_at IS NULL", [archiveId]);
    if (!rows[0]) throw new HttpError(404, "not_found");
    return rows[0] as { id: string; title: string; visibility: string };
  }

  const mode = (visibility: string) => (visibility === "org" || visibility === "public" ? "everyone" : "restricted");

  return async (r: FastifyInstance) => {
    // Every archive, with whether it is open to everyone and how many group grants it has.
    r.get("/v1/group-access/archives", async (req) => {
      const a = await caller(req, "content:read");
      const { rows } = await pool.query(
        `SELECT m.id, m.title, m.visibility,
                (SELECT count(*)::int FROM content.grants g WHERE g.object_type = 'archive' AND g.object_id = m.id AND g.subject_type = 'group') AS group_grants
           FROM content.master_items m
          WHERE m.deleted_at IS NULL
          ORDER BY lower(m.title) LIMIT 1000`,
        [],
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
          ORDER BY lower(m.title) LIMIT 1000`,
        [groupId],
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
        await client.query("SELECT 1 FROM content.master_items WHERE id = $1 FOR UPDATE", [archive.id]);
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

    // Who can see the archive without a grant.
    r.put("/v1/group-access/archives/:id/access", async (req) => {
      const a = await caller(req, "content:share");
      const archive = await managed(a, idParam(req));
      const body = parse(setMode, req.body);
      // Already in the requested mode: leave the exact visibility (private, shared, org, public) alone.
      const visibility = mode(archive.visibility) === body.mode ? archive.visibility : body.mode === "everyone" ? "org" : "shared";
      if (visibility !== archive.visibility) await pool.query("UPDATE content.master_items SET visibility = $2, updated_at = now() WHERE id = $1", [archive.id, visibility]);
      return { archiveId: archive.id, access: body.mode, visibility };
    });
  };
}
