import { hash } from "@node-rs/argon2";
import { ROLES, type Role } from "@ultimyr/authz";
import { and, desc, eq, ilike, inArray, lt, or, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { auditCsv } from "../audit-csv.js";
import { createAbout } from "../about.js";
import { HttpError, type Ctx } from "../ctx.js";
import { uuidv7 } from "../ids.js";
import { auditLog, groupMembers, groups, idpProviders, instanceSettings, passwordTokens, roleAssignments, scimTokens, sessions, users } from "../schema.js";
import { randomToken } from "../secrets.js";
import { parse } from "./core.js";

const patchUserBody = z.object({
  status: z.enum(["active", "suspended"]).optional(),
  roles: z.array(z.enum(ROLES)).optional(),
});
const groupBody = z.object({ name: z.string().trim().min(1).max(100) });
const memberBody = z.object({ userId: z.uuid() });
const settingsBody = z.object({ registrationOpen: z.boolean().nullable().optional(), localUsersDisabled: z.boolean().optional() });
const createUserBody = z.object({
  email: z.email().max(254),
  displayName: z.string().trim().min(1).max(80),
  roles: z.array(z.enum(ROLES)).min(1).default(["author", "learner"]),
  /** "password": a temporary password they must replace at first sign-in. "invite": a one-time link to choose their own. */
  method: z.enum(["password", "invite"]).default("invite"),
  /** Optional for "password"; one is generated when left out. */
  password: z.string().min(12, "Password must be at least 12 characters").max(128).optional(),
});
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const tokenBody = z.object({ name: z.string().trim().min(1).max(60) });

export function adminRoutes(ctx: Ctx) {
  const { db, secrets } = ctx;

  async function activeAdminCount(excludingUserId?: string): Promise<number> {
    const rows = await db
      .select({ n: sql<number>`count(distinct ${users.id})::int` })
      .from(users)
      .innerJoin(roleAssignments, eq(roleAssignments.userId, users.id))
      .where(
        and(
          eq(roleAssignments.role, "platform_admin"),
          eq(users.status, "active"),
          excludingUserId ? sql`${users.id} <> ${excludingUserId}` : undefined,
        ),
      );
    return rows[0]?.n ?? 0;
  }

  const about = createAbout({ repo: ctx.config.repo, enabled: ctx.config.updateCheck });

  async function settingsView() {
    return {
      localUsersDisabled: await ctx.localUsersDisabled(),
      registrationOpen: await ctx.registrationOpen(),
      registrationOverridden: (await db.select({ k: instanceSettings.key }).from(instanceSettings).where(eq(instanceSettings.key, "registrationOpen"))).length > 0,
      registrationDefault: ctx.config.registrationOpen,
    };
  }

  return async (r: FastifyInstance) => {
    // ---- general ----------------------------------------------------------
    r.get("/v1/admin/overview", async (req) => {
      await ctx.requireAdmin(req);
      const [u] = await db
        .select({
          total: sql<number>`count(*)::int`,
          active: sql<number>`count(*) FILTER (WHERE ${users.status} = 'active')::int`,
          suspended: sql<number>`count(*) FILTER (WHERE ${users.status} = 'suspended')::int`,
        })
        .from(users);
      const [g] = await db.select({ n: sql<number>`count(*)::int` }).from(groups);
      const [p] = await db.select({ n: sql<number>`count(*) FILTER (WHERE ${idpProviders.enabled})::int` }).from(idpProviders);
      return {
        users: u ?? { total: 0, active: 0, suspended: 0 },
        admins: await activeAdminCount(),
        groups: g?.n ?? 0,
        signInProviders: p?.n ?? 0,
        deployment: { publicUrl: ctx.config.publicUrl, environment: ctx.config.nodeEnv },
        settings: await settingsView(),
      };
    });

    // Running build, latest GitHub release and changelog. Cached for an hour; `?refresh=1` re-checks (at most every 30 seconds).
    r.get("/v1/admin/about", async (req) => {
      await ctx.requireAdmin(req);
      const q = req.query as { refresh?: string };
      return about(q.refresh === "1");
    });

    r.get("/v1/admin/settings", async (req) => {
      await ctx.requireAdmin(req);
      return settingsView();
    });

    // `registrationOpen: null` removes the override and falls back to AUTH_REGISTRATION.
    r.patch("/v1/admin/settings", async (req) => {
      const { user } = await ctx.requireAdmin(req);
      const body = parse(settingsBody, req.body);
      if (body.localUsersDisabled === true) {
        // Refuse to switch passwords off with nothing to replace them: someone must be able to sign in another way.
        const [p] = await db.select({ n: sql<number>`count(*)::int` }).from(idpProviders).where(eq(idpProviders.enabled, true));
        if (!p?.n) throw new HttpError(409, "no_identity_provider");
      }
      if (body.localUsersDisabled !== undefined) {
        await db
          .insert(instanceSettings)
          .values({ key: "localUsersDisabled", value: body.localUsersDisabled, updatedBy: user.id })
          .onConflictDoUpdate({ target: instanceSettings.key, set: { value: body.localUsersDisabled, updatedBy: user.id, updatedAt: new Date() } });
      }
      if (body.registrationOpen === null) {
        await db.delete(instanceSettings).where(eq(instanceSettings.key, "registrationOpen"));
      } else if (body.registrationOpen !== undefined) {
        await db
          .insert(instanceSettings)
          .values({ key: "registrationOpen", value: body.registrationOpen, updatedBy: user.id })
          .onConflictDoUpdate({ target: instanceSettings.key, set: { value: body.registrationOpen, updatedBy: user.id, updatedAt: new Date() } });
      }
      await ctx.audit("admin.settings_updated", req, user.id, null, { ...body });
      return settingsView();
    });

    // ---- users ------------------------------------------------------------
    r.get("/v1/admin/users", async (req) => {
      await ctx.requireAdmin(req);
      const q = z
        .object({ q: z.string().max(100).optional(), limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0) })
        .parse(req.query);
      const where = q.q ? or(ilike(users.email, `%${q.q}%`), ilike(users.displayName, `%${q.q}%`)) : undefined;
      const rows = await db.select().from(users).where(where).orderBy(users.createdAt, users.id).limit(q.limit).offset(q.offset);
      const roleRows = rows.length ? await db.select().from(roleAssignments).where(inArray(roleAssignments.userId, rows.map((u) => u.id))) : [];
      return rows.map((u) => ({
        id: u.id,
        email: u.email,
        displayName: u.displayName,
        status: u.status,
        createdVia: u.createdVia,
        mustChangePassword: u.mustChangePassword,
        createdAt: u.createdAt,
        roles: roleRows.filter((x) => x.userId === u.id).map((x) => x.role),
      }));
    });

    // Manual account creation. The person gets a temporary password (forced change at first sign-in) or a one-time invite link.
    // The password and link are returned once and never stored in readable form.
    r.post("/v1/admin/users", async (req, reply) => {
      const { user: admin } = await ctx.requireAdmin(req);
      const body = parse(createUserBody, req.body);
      if (await ctx.localUsersDisabled()) throw new HttpError(409, "local_users_disabled");
      const roles: Role[] = [...new Set(body.roles)];
      const id = uuidv7();
      const temporaryPassword = body.method === "password" ? (body.password ?? randomToken(18)) : undefined;
      const passwordHash = temporaryPassword ? await hash(temporaryPassword) : null;
      const inviteToken = body.method === "invite" ? `ulinv_${randomToken(32)}` : undefined;

      const created = await db.transaction(async (tx) => {
        const exists = await tx.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = lower(${body.email})`);
        if (exists.length) return false;
        await tx.insert(users).values({ id, email: body.email, displayName: body.displayName, passwordHash, mustChangePassword: Boolean(temporaryPassword), createdVia: "local" });
        await tx.insert(roleAssignments).values(roles.map((role) => ({ userId: id, role })));
        if (inviteToken) await tx.insert(passwordTokens).values({ id: uuidv7(), userId: id, tokenHash: secrets.hashToken(inviteToken), expiresAt: new Date(Date.now() + INVITE_TTL_MS), createdBy: admin.id });
        return true;
      });
      if (!created) throw new HttpError(409, "email_taken");
      await ctx.audit("admin.user_created", req, admin.id, id, { method: body.method, roles });
      return reply.code(201).send({
        id,
        email: body.email,
        displayName: body.displayName,
        roles,
        ...(temporaryPassword ? { temporaryPassword } : {}),
        ...(inviteToken ? { inviteUrl: `${ctx.config.publicUrl}/set-password?token=${inviteToken}`, inviteExpiresAt: new Date(Date.now() + INVITE_TTL_MS) } : {}),
      });
    });

    // A fresh one-time link for a local account (a lapsed invite, or a forgotten password). Older links stop working.
    r.post("/v1/admin/users/:id/invite", async (req) => {
      const { user: admin } = await ctx.requireAdmin(req);
      const { id } = req.params as { id: string };
      const [target] = await db.select().from(users).where(eq(users.id, id)).catch(() => []);
      if (!target) throw new HttpError(404, "not_found");
      if (target.createdVia !== "local") throw new HttpError(409, "not_local_account");
      if (await ctx.localUsersDisabled()) throw new HttpError(409, "local_users_disabled");
      const inviteToken = `ulinv_${randomToken(32)}`;
      await db.transaction(async (tx) => {
        await tx.update(passwordTokens).set({ usedAt: new Date() }).where(and(eq(passwordTokens.userId, id), sql`${passwordTokens.usedAt} IS NULL`));
        await tx.insert(passwordTokens).values({ id: uuidv7(), userId: id, tokenHash: secrets.hashToken(inviteToken), expiresAt: new Date(Date.now() + INVITE_TTL_MS), createdBy: admin.id });
      });
      await ctx.audit("admin.invite_created", req, admin.id, id);
      return { inviteUrl: `${ctx.config.publicUrl}/set-password?token=${inviteToken}`, inviteExpiresAt: new Date(Date.now() + INVITE_TTL_MS) };
    });

    r.patch("/v1/admin/users/:id", async (req) => {
      const { user: admin } = await ctx.requireAdmin(req);
      const { id } = req.params as { id: string };
      const body = parse(patchUserBody, req.body);
      const [target] = await db.select().from(users).where(eq(users.id, id)).catch(() => []);
      if (!target) throw new HttpError(404, "not_found");

      const losesAdmin =
        (body.status === "suspended" || (body.roles && !body.roles.includes("platform_admin"))) &&
        (await ctx.rolesFor(id)).includes("platform_admin") &&
        target.status === "active";
      if (losesAdmin && (await activeAdminCount(id)) === 0) throw new HttpError(409, "last_admin");

      if (body.status) {
        await db.update(users).set({ status: body.status, updatedAt: new Date() }).where(eq(users.id, id));
        if (body.status === "suspended") await db.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, id), sql`${sessions.revokedAt} IS NULL`));
      }
      if (body.roles) {
        await db.transaction(async (tx) => {
          await tx.delete(roleAssignments).where(eq(roleAssignments.userId, id));
          const roles: Role[] = [...new Set(body.roles)];
          if (roles.length) await tx.insert(roleAssignments).values(roles.map((role) => ({ userId: id, role })));
        });
      }
      await ctx.audit("admin.user_updated", req, admin.id, id, { ...body });
      const [u] = await db.select().from(users).where(eq(users.id, id));
      return { id, status: u!.status, roles: await ctx.rolesFor(id) };
    });

    // ---- groups -----------------------------------------------------------
    r.get("/v1/admin/groups", async (req) => {
      await ctx.requireAdmin(req);
      const rows = await db
        .select({ id: groups.id, name: groups.name, source: groups.source, members: sql<number>`(SELECT count(*)::int FROM auth.group_members m WHERE m.group_id = ${groups.id})` })
        .from(groups)
        .orderBy(groups.name);
      return rows;
    });

    r.post("/v1/admin/groups", async (req, reply) => {
      const { user } = await ctx.requireAdmin(req);
      const { name } = parse(groupBody, req.body);
      const id = uuidv7();
      try {
        await db.insert(groups).values({ id, name, source: "local" });
      } catch {
        throw new HttpError(409, "group_exists");
      }
      await ctx.audit("admin.group_created", req, user.id, id);
      return reply.code(201).send({ id, name, source: "local" });
    });

    r.delete("/v1/admin/groups/:id", async (req, reply) => {
      const { user } = await ctx.requireAdmin(req);
      const { id } = req.params as { id: string };
      const res = await db.delete(groups).where(and(eq(groups.id, id), eq(groups.source, "local"))).returning({ id: groups.id }).catch(() => []);
      if (!res.length) throw new HttpError(404, "not_found");
      await ctx.audit("admin.group_deleted", req, user.id, id);
      return reply.code(204).send();
    });

    r.get("/v1/admin/groups/:id/members", async (req) => {
      await ctx.requireAdmin(req);
      const { id } = req.params as { id: string };
      return db
        .select({ id: users.id, email: users.email, displayName: users.displayName })
        .from(groupMembers)
        .innerJoin(users, eq(users.id, groupMembers.userId))
        .where(eq(groupMembers.groupId, id));
    });

    // Only locally managed groups are edited here. SCIM and SSO groups are owned by the identity provider.
    r.post("/v1/admin/groups/:id/members", async (req, reply) => {
      const { user } = await ctx.requireAdmin(req);
      const { id } = req.params as { id: string };
      const { userId } = parse(memberBody, req.body);
      const [g] = await db.select().from(groups).where(eq(groups.id, id)).catch(() => []);
      if (!g) throw new HttpError(404, "not_found");
      if (g.source !== "local") throw new HttpError(409, "group_managed_externally");
      const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId));
      if (!u) throw new HttpError(404, "user_not_found");
      await db.insert(groupMembers).values({ groupId: id, userId }).onConflictDoNothing();
      await ctx.audit("admin.group_member_added", req, user.id, id, { userId });
      return reply.code(204).send();
    });

    r.delete("/v1/admin/groups/:id/members/:userId", async (req, reply) => {
      const { user } = await ctx.requireAdmin(req);
      const { id, userId } = req.params as { id: string; userId: string };
      const [g] = await db.select().from(groups).where(eq(groups.id, id)).catch(() => []);
      if (!g) throw new HttpError(404, "not_found");
      if (g.source !== "local") throw new HttpError(409, "group_managed_externally");
      await db.delete(groupMembers).where(and(eq(groupMembers.groupId, id), eq(groupMembers.userId, userId))).catch(() => undefined);
      await ctx.audit("admin.group_member_removed", req, user.id, id, { userId });
      return reply.code(204).send();
    });

    r.get("/v1/me/groups", async (req) => {
      const { user } = await ctx.authenticate(req);
      return db
        .select({ id: groups.id, name: groups.name, source: groups.source })
        .from(groupMembers)
        .innerJoin(groups, eq(groups.id, groupMembers.groupId))
        .where(eq(groupMembers.userId, user.id));
    });

    // ---- SCIM tokens ------------------------------------------------------
    r.get("/v1/admin/scim-tokens", async (req) => {
      await ctx.requireAdmin(req);
      const rows = await db.select().from(scimTokens).orderBy(desc(scimTokens.createdAt));
      return rows.map((t) => ({ id: t.id, name: t.name, createdAt: t.createdAt, lastUsedAt: t.lastUsedAt, revokedAt: t.revokedAt }));
    });

    r.post("/v1/admin/scim-tokens", async (req, reply) => {
      const { user } = await ctx.requireAdmin(req);
      const { name } = parse(tokenBody, req.body);
      const token = `ulscim_${randomToken(32)}`;
      const id = uuidv7();
      await db.insert(scimTokens).values({ id, name, tokenHash: secrets.hashToken(token), createdBy: user.id });
      await ctx.audit("admin.scim_token_created", req, user.id, id);
      return reply.code(201).send({ id, name, token });
    });

    r.delete("/v1/admin/scim-tokens/:id", async (req, reply) => {
      const { user } = await ctx.requireAdmin(req);
      const { id } = req.params as { id: string };
      const res = await db
        .update(scimTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(scimTokens.id, id), sql`${scimTokens.revokedAt} IS NULL`))
        .returning({ id: scimTokens.id })
        .catch(() => []);
      if (!res.length) throw new HttpError(404, "not_found");
      await ctx.audit("admin.scim_token_revoked", req, user.id, id);
      return reply.code(204).send();
    });

    // ---- audit log --------------------------------------------------------
    r.get("/v1/admin/audit", async (req, reply) => {
      await ctx.requireAdmin(req);
      const q = z
        .object({
          limit: z.coerce.number().int().min(1).max(5000).default(100),
          action: z.string().max(80).optional(),
          before: z.coerce.number().int().positive().optional(),
          format: z.enum(["json", "csv"]).default("json"),
        })
        .parse(req.query);
      if (q.format === "json" && q.limit > 500) throw new HttpError(400, "limit_too_large");
      const rows = await db
        .select()
        .from(auditLog)
        .where(and(q.action ? eq(auditLog.action, q.action) : undefined, q.before ? lt(auditLog.id, q.before) : undefined))
        .orderBy(desc(auditLog.id))
        .limit(q.limit);
      if (q.format === "csv") {
        return reply
          .type("text/csv; charset=utf-8")
          .header("content-disposition", 'attachment; filename="ultimyr-audit-log.csv"')
          .send(auditCsv(rows));
      }
      return rows;
    });

    // Every action name that has been logged, so the audit page can offer them all as filters.
    r.get("/v1/admin/audit/actions", async (req) => {
      await ctx.requireAdmin(req);
      const rows = await db.selectDistinct({ action: auditLog.action }).from(auditLog).orderBy(auditLog.action);
      return rows.map((r) => r.action);
    });
  };
}
