import { and, eq, inArray, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Ctx } from "../ctx.js";
import { uuidv7 } from "../ids.js";
import { groupMembers, groups, roleAssignments, scimTokens, sessions, users } from "../schema.js";

const USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";
const GROUP_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:Group";
const LIST_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:ListResponse";
const ERROR_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:Error";
const PATCH_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:PatchOp";
const MAX_COUNT = 200;

class ScimError extends Error {
  constructor(
    public status: number,
    public detail: string,
    public scimType?: string,
  ) {
    super(detail);
  }
}

type UserRow = typeof users.$inferSelect;
type GroupRow = typeof groups.$inferSelect;
type Json = Record<string, unknown>;

const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const asBool = (v: unknown): boolean | undefined => {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v.toLowerCase() === "true" ? true : v.toLowerCase() === "false" ? false : undefined;
  return undefined;
};

/** Supports the filters IdPs actually send: `attr eq "value"` (optionally with the attribute path in any case). */
function parseFilter(filter: string | undefined, allowed: string[]): { attr: string; value: string } | null {
  if (!filter) return null;
  const m = /^\s*([A-Za-z0-9_.]+)\s+eq\s+"((?:[^"\\]|\\.)*)"\s*$/i.exec(filter);
  if (!m) throw new ScimError(400, "Only simple 'attribute eq \"value\"' filters are supported", "invalidFilter");
  const attr = allowed.find((a) => a.toLowerCase() === m[1]!.toLowerCase());
  if (!attr) throw new ScimError(400, `Filtering on ${m[1]} is not supported`, "invalidFilter");
  return { attr, value: m[2]!.replace(/\\(.)/g, "$1") };
}

export function scimRoutes(ctx: Ctx) {
  const { db, secrets, config } = ctx;
  const base = () => `${config.publicUrl}/scim/v2`;

  async function authenticate(req: FastifyRequest) {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) throw new ScimError(401, "Missing bearer token");
    const [t] = await db.select().from(scimTokens).where(eq(scimTokens.tokenHash, secrets.hashToken(header.slice(7))));
    if (!t || t.revokedAt) throw new ScimError(401, "Invalid token");
    await db.update(scimTokens).set({ lastUsedAt: new Date() }).where(eq(scimTokens.id, t.id));
    return t;
  }

  async function userResource(u: UserRow): Promise<Json> {
    const gs = await db
      .select({ id: groups.id, name: groups.name })
      .from(groupMembers)
      .innerJoin(groups, eq(groups.id, groupMembers.groupId))
      .where(eq(groupMembers.userId, u.id));
    return {
      schemas: [USER_SCHEMA],
      id: u.id,
      ...(u.externalId ? { externalId: u.externalId } : {}),
      userName: u.email,
      name: {
        formatted: u.displayName,
        ...(u.givenName ? { givenName: u.givenName } : {}),
        ...(u.familyName ? { familyName: u.familyName } : {}),
      },
      displayName: u.displayName,
      emails: [{ value: u.email, type: "work", primary: true }],
      active: u.status === "active",
      groups: gs.map((g) => ({ value: g.id, display: g.name })),
      meta: { resourceType: "User", created: u.createdAt, lastModified: u.updatedAt, location: `${base()}/Users/${u.id}` },
    };
  }

  async function groupResource(g: GroupRow): Promise<Json> {
    const ms = await db
      .select({ id: users.id, email: users.email })
      .from(groupMembers)
      .innerJoin(users, eq(users.id, groupMembers.userId))
      .where(eq(groupMembers.groupId, g.id));
    return {
      schemas: [GROUP_SCHEMA],
      id: g.id,
      ...(g.externalId ? { externalId: g.externalId } : {}),
      displayName: g.name,
      members: ms.map((m) => ({ value: m.id, display: m.email })),
      meta: { resourceType: "Group", created: g.createdAt, lastModified: g.updatedAt, location: `${base()}/Groups/${g.id}` },
    };
  }

  const paging = (q: Json) => {
    const startIndex = Math.max(1, Number(q.startIndex) || 1);
    const count = Math.min(MAX_COUNT, Math.max(0, q.count === undefined ? 100 : Number(q.count) || 0));
    return { startIndex, count };
  };
  const list = (resources: Json[], total: number, startIndex: number) => ({
    schemas: [LIST_SCHEMA],
    totalResults: total,
    startIndex,
    itemsPerPage: resources.length,
    Resources: resources,
  });

  // ---- users: input handling ------------------------------------------------
  interface UserAttrs {
    userName?: string;
    externalId?: string | null;
    displayName?: string;
    givenName?: string | null;
    familyName?: string | null;
    active?: boolean;
  }

  function attrsFromResource(body: Json): UserAttrs {
    const a: UserAttrs = {};
    if (typeof body.userName === "string") a.userName = body.userName.trim();
    if (typeof body.externalId === "string") a.externalId = body.externalId;
    if (typeof body.displayName === "string") a.displayName = body.displayName;
    if (isObj(body.name)) {
      if (typeof body.name.givenName === "string") a.givenName = body.name.givenName;
      if (typeof body.name.familyName === "string") a.familyName = body.name.familyName;
      if (typeof body.name.formatted === "string" && a.displayName === undefined) a.displayName = body.name.formatted;
    }
    const active = asBool(body.active);
    if (active !== undefined) a.active = active;
    return a;
  }

  /** Apply one PATCH operation (Okta and Entra variants) to the attribute set. */
  function applyUserOp(a: UserAttrs, op: Json) {
    const kind = String(op.op ?? "").toLowerCase();
    if (!["add", "replace", "remove"].includes(kind)) throw new ScimError(400, `Unsupported op ${String(op.op)}`, "invalidSyntax");
    const path = typeof op.path === "string" ? op.path : "";
    const value = op.value;
    if (!path) {
      if (isObj(value)) Object.assign(a, attrsFromResource(value));
      return;
    }
    const p = path.toLowerCase();
    const set = <K extends keyof UserAttrs>(k: K, v: UserAttrs[K]) => {
      a[k] = kind === "remove" ? (null as UserAttrs[K]) : v;
    };
    if (p === "username") a.userName = String(value ?? "").trim();
    else if (p === "externalid") set("externalId", typeof value === "string" ? value : null);
    else if (p === "displayname") set("displayName", typeof value === "string" ? value : undefined);
    else if (p === "name.givenname") set("givenName", typeof value === "string" ? value : null);
    else if (p === "name.familyname") set("familyName", typeof value === "string" ? value : null);
    else if (p === "name.formatted") a.displayName = typeof value === "string" ? value : a.displayName;
    else if (p === "active") {
      const b = asBool(value);
      if (b === undefined) throw new ScimError(400, "active must be a boolean", "invalidValue");
      a.active = b;
    } else if (p.startsWith("emails")) {
      // emails, emails[type eq "work"].value, emails[primary eq true].value
      const v = Array.isArray(value) ? (value[0] as Json | undefined)?.value : isObj(value) ? value.value : value;
      if (typeof v === "string") a.userName = v.trim();
    }
    // Unknown attributes (title, phoneNumbers, enterprise extensions) are accepted and ignored.
  }

  async function revokeSessions(userId: string) {
    await db.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, userId), sql`${sessions.revokedAt} IS NULL`));
  }

  async function applyUserAttrs(id: string, current: UserRow, a: UserAttrs): Promise<UserRow> {
    const set: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };
    if (a.userName !== undefined && a.userName.toLowerCase() !== current.email.toLowerCase()) {
      if (!/^[^@\s]+@[^@\s]+$/.test(a.userName)) throw new ScimError(400, "userName must be an email address", "invalidValue");
      const [dup] = await db.select({ id: users.id }).from(users).where(and(sql`lower(${users.email}) = lower(${a.userName})`, sql`${users.id} <> ${id}`));
      if (dup) throw new ScimError(409, "userName is already in use", "uniqueness");
      set.email = a.userName;
    }
    if (a.externalId !== undefined) set.externalId = a.externalId;
    if (a.displayName !== undefined) set.displayName = a.displayName.trim().slice(0, 80) || current.displayName;
    if (a.givenName !== undefined) set.givenName = a.givenName;
    if (a.familyName !== undefined) set.familyName = a.familyName;
    if (a.active === false && current.status !== "deprovisioned") {
      set.status = "deprovisioned";
      await revokeSessions(id);
    } else if (a.active === true && current.status === "deprovisioned") set.status = "active";
    set.scimManaged = true;
    try {
      await db.update(users).set(set).where(eq(users.id, id));
    } catch {
      throw new ScimError(409, "externalId or userName is already in use", "uniqueness");
    }
    const [u] = await db.select().from(users).where(eq(users.id, id));
    return u!;
  }

  async function findUser(id: string): Promise<UserRow> {
    const [u] = await db.select().from(users).where(eq(users.id, id)).catch(() => []);
    if (!u) throw new ScimError(404, "User not found");
    return u;
  }
  async function findGroup(id: string): Promise<GroupRow> {
    const [g] = await db.select().from(groups).where(and(eq(groups.id, id), eq(groups.source, "scim"))).catch(() => []);
    if (!g) throw new ScimError(404, "Group not found");
    return g;
  }

  async function memberIds(value: unknown): Promise<string[]> {
    const ids = (Array.isArray(value) ? value : [value]).map((m) => (isObj(m) ? m.value : m)).filter((v): v is string => typeof v === "string");
    if (!ids.length) return [];
    const found = await db.select({ id: users.id }).from(users).where(inArray(users.id, ids)).catch(() => {
      throw new ScimError(400, "Invalid member id", "invalidValue");
    });
    if (found.length !== new Set(ids).size) throw new ScimError(400, "Unknown member id", "invalidValue");
    return [...new Set(ids)];
  }

  return async (r: FastifyInstance) => {
    r.addContentTypeParser("application/scim+json", { parseAs: "string" }, (_req, body, done) => {
      try {
        done(null, body ? JSON.parse(body as string) : {});
      } catch {
        done(new ScimError(400, "Invalid JSON", "invalidSyntax"), undefined);
      }
    });
    r.setErrorHandler((err: Error & { statusCode?: number }, _req: FastifyRequest, reply: FastifyReply) => {
      const status = err instanceof ScimError ? err.status : (err.statusCode ?? 500);
      if (status >= 500) r.log.error(err);
      return reply
        .code(status)
        .type("application/scim+json")
        .send({ schemas: [ERROR_SCHEMA], status: String(status), detail: status >= 500 ? "Internal error" : err.message, ...(err instanceof ScimError && err.scimType ? { scimType: err.scimType } : {}) });
    });
    r.addHook("onRequest", async (req) => {
      await authenticate(req);
    });
    r.addHook("onSend", async (_req, reply, payload) => {
      if (!reply.getHeader("content-type")?.toString().includes("json")) return payload;
      reply.type("application/scim+json");
      return payload;
    });

    const P = "/scim/v2";

    // ---- discovery ----------------------------------------------------------
    r.get(`${P}/ServiceProviderConfig`, async () => ({
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
      patch: { supported: true },
      bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
      filter: { supported: true, maxResults: MAX_COUNT },
      changePassword: { supported: false },
      sort: { supported: false },
      etag: { supported: false },
      authenticationSchemes: [{ type: "oauthbearertoken", name: "Bearer token", description: "Token created by an administrator", primary: true }],
    }));
    r.get(`${P}/ResourceTypes`, async () =>
      list(
        [
          { schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"], id: "User", name: "User", endpoint: "/Users", schema: USER_SCHEMA },
          { schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"], id: "Group", name: "Group", endpoint: "/Groups", schema: GROUP_SCHEMA },
        ],
        2,
        1,
      ),
    );
    r.get(`${P}/Schemas`, async () =>
      list(
        [
          { id: USER_SCHEMA, name: "User", description: "User account", attributes: [] },
          { id: GROUP_SCHEMA, name: "Group", description: "Group", attributes: [] },
        ],
        2,
        1,
      ),
    );

    // ---- users --------------------------------------------------------------
    r.get(`${P}/Users`, async (req) => {
      const q = req.query as Json;
      const f = parseFilter(q.filter as string | undefined, ["userName", "externalId", "id", "displayName"]);
      const { startIndex, count } = paging(q);
      const col = f && { userName: users.email, externalId: users.externalId, id: users.id, displayName: users.displayName }[f.attr as "userName"];
      const where =
        f && col
          ? f.attr === "userName"
            ? sql`lower(${users.email}) = lower(${f.value})`
            : f.attr === "id"
              ? sql`${users.id}::text = ${f.value}`
              : eq(col, f.value)
          : undefined;
      const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(users).where(where);
      const rows = count ? await db.select().from(users).where(where).orderBy(users.createdAt, users.id).limit(count).offset(startIndex - 1) : [];
      return list(await Promise.all(rows.map(userResource)), n, startIndex);
    });

    r.get(`${P}/Users/:id`, async (req) => userResource(await findUser((req.params as { id: string }).id)));

    r.post(`${P}/Users`, async (req, reply) => {
      const body = isObj(req.body) ? req.body : {};
      const a = attrsFromResource(body);
      if (!a.userName || !/^[^@\s]+@[^@\s]+$/.test(a.userName)) throw new ScimError(400, "userName (an email address) is required", "invalidValue");
      const [dup] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = lower(${a.userName})`);
      if (dup) throw new ScimError(409, "User already exists", "uniqueness");
      const id = uuidv7();
      const displayName = (a.displayName || [a.givenName, a.familyName].filter(Boolean).join(" ") || a.userName.split("@")[0]!).slice(0, 80);
      try {
        await db.insert(users).values({
          id,
          email: a.userName,
          displayName,
          givenName: a.givenName ?? null,
          familyName: a.familyName ?? null,
          externalId: a.externalId ?? null,
          createdVia: "scim",
          scimManaged: true,
          status: a.active === false ? "deprovisioned" : "active",
        });
      } catch {
        throw new ScimError(409, "User already exists", "uniqueness");
      }
      await db.insert(roleAssignments).values([{ userId: id, role: "author" }, { userId: id, role: "learner" }]);
      await ctx.audit("scim.user_created", req, null, id);
      return reply.code(201).header("location", `${base()}/Users/${id}`).send(await userResource(await findUser(id)));
    });

    r.put(`${P}/Users/:id`, async (req) => {
      const { id } = req.params as { id: string };
      const current = await findUser(id);
      const body = isObj(req.body) ? req.body : {};
      const a = attrsFromResource(body);
      // PUT replaces the resource: attributes that are absent are cleared.
      if (a.active === undefined) a.active = true;
      a.externalId ??= null;
      a.givenName ??= null;
      a.familyName ??= null;
      const u = await applyUserAttrs(id, current, a);
      await ctx.audit("scim.user_replaced", req, null, id);
      return userResource(u);
    });

    r.patch(`${P}/Users/:id`, async (req) => {
      const { id } = req.params as { id: string };
      const current = await findUser(id);
      const body = isObj(req.body) ? req.body : {};
      if (!Array.isArray(body.Operations)) throw new ScimError(400, "Operations is required", "invalidSyntax");
      const a: UserAttrs = {};
      for (const op of body.Operations) if (isObj(op)) applyUserOp(a, op);
      const u = await applyUserAttrs(id, current, a);
      await ctx.audit("scim.user_patched", req, null, id, { active: a.active });
      return userResource(u);
    });

    r.delete(`${P}/Users/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      await findUser(id);
      await db.delete(users).where(eq(users.id, id));
      await ctx.audit("scim.user_deleted", req, null, id);
      return reply.code(204).send();
    });

    // ---- groups -------------------------------------------------------------
    r.get(`${P}/Groups`, async (req) => {
      const q = req.query as Json;
      const f = parseFilter(q.filter as string | undefined, ["displayName", "externalId", "id"]);
      const { startIndex, count } = paging(q);
      const where = and(
        eq(groups.source, "scim"),
        f ? (f.attr === "displayName" ? sql`lower(${groups.name}) = lower(${f.value})` : f.attr === "id" ? sql`${groups.id}::text = ${f.value}` : eq(groups.externalId, f.value)) : undefined,
      );
      const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(groups).where(where);
      const rows = count ? await db.select().from(groups).where(where).orderBy(groups.createdAt, groups.id).limit(count).offset(startIndex - 1) : [];
      return list(await Promise.all(rows.map(groupResource)), n, startIndex);
    });

    r.get(`${P}/Groups/:id`, async (req) => groupResource(await findGroup((req.params as { id: string }).id)));

    r.post(`${P}/Groups`, async (req, reply) => {
      const body = isObj(req.body) ? req.body : {};
      const name = typeof body.displayName === "string" ? body.displayName.trim() : "";
      if (!name) throw new ScimError(400, "displayName is required", "invalidValue");
      const ids = await memberIds(body.members ?? []);
      const id = uuidv7();
      try {
        await db.insert(groups).values({ id, name: name.slice(0, 100), source: "scim", externalId: typeof body.externalId === "string" ? body.externalId : null });
      } catch {
        throw new ScimError(409, "Group already exists", "uniqueness");
      }
      if (ids.length) await db.insert(groupMembers).values(ids.map((userId) => ({ groupId: id, userId })));
      await ctx.audit("scim.group_created", req, null, id);
      return reply.code(201).header("location", `${base()}/Groups/${id}`).send(await groupResource(await findGroup(id)));
    });

    const setMembers = async (id: string, ids: string[]) => {
      await db.transaction(async (tx) => {
        await tx.delete(groupMembers).where(eq(groupMembers.groupId, id));
        if (ids.length) await tx.insert(groupMembers).values(ids.map((userId) => ({ groupId: id, userId })));
      });
    };

    r.put(`${P}/Groups/:id`, async (req) => {
      const { id } = req.params as { id: string };
      await findGroup(id);
      const body = isObj(req.body) ? req.body : {};
      const ids = await memberIds(body.members ?? []);
      const set: Partial<typeof groups.$inferInsert> = { updatedAt: new Date(), externalId: typeof body.externalId === "string" ? body.externalId : null };
      if (typeof body.displayName === "string" && body.displayName.trim()) set.name = body.displayName.trim().slice(0, 100);
      try {
        await db.update(groups).set(set).where(eq(groups.id, id));
      } catch {
        throw new ScimError(409, "Group name already exists", "uniqueness");
      }
      await setMembers(id, ids);
      await ctx.audit("scim.group_replaced", req, null, id);
      return groupResource(await findGroup(id));
    });

    r.patch(`${P}/Groups/:id`, async (req) => {
      const { id } = req.params as { id: string };
      await findGroup(id);
      const body = isObj(req.body) ? req.body : {};
      if (!Array.isArray(body.Operations)) throw new ScimError(400, "Operations is required", "invalidSyntax");
      for (const raw of body.Operations) {
        if (!isObj(raw)) continue;
        const kind = String(raw.op ?? "").toLowerCase();
        const path = typeof raw.path === "string" ? raw.path : "";
        const lower = path.toLowerCase();
        if (lower === "displayname" || (!path && isObj(raw.value) && typeof raw.value.displayName === "string")) {
          const name = String(lower === "displayname" ? raw.value : (raw.value as Json).displayName).trim();
          if (name) await db.update(groups).set({ name: name.slice(0, 100), updatedAt: new Date() }).where(eq(groups.id, id));
          if (!path && isObj(raw.value) && raw.value.members !== undefined) await applyMembers(id, kind, "members", raw.value.members);
        } else if (lower.startsWith("members")) {
          await applyMembers(id, kind, path, raw.value);
        } else if (!path && isObj(raw.value) && raw.value.members !== undefined) {
          await applyMembers(id, kind, "members", raw.value.members);
        }
      }
      await ctx.audit("scim.group_patched", req, null, id);
      return groupResource(await findGroup(id));
    });

    async function applyMembers(id: string, kind: string, path: string, value: unknown) {
      const filter = /members\[value eq "([^"]+)"\]/i.exec(path);
      if (kind === "remove") {
        const ids = filter ? [filter[1]!] : value === undefined ? null : await memberIds(value);
        await db.delete(groupMembers).where(ids ? and(eq(groupMembers.groupId, id), inArray(groupMembers.userId, ids)) : eq(groupMembers.groupId, id));
      } else if (kind === "add") {
        const ids = await memberIds(value);
        if (ids.length) await db.insert(groupMembers).values(ids.map((userId) => ({ groupId: id, userId }))).onConflictDoNothing();
      } else if (kind === "replace") {
        await setMembers(id, await memberIds(value ?? []));
      } else throw new ScimError(400, `Unsupported op ${kind}`, "invalidSyntax");
      await db.update(groups).set({ updatedAt: new Date() }).where(eq(groups.id, id));
    }

    r.delete(`${P}/Groups/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      await findGroup(id);
      await db.delete(groups).where(eq(groups.id, id));
      await ctx.audit("scim.group_deleted", req, null, id);
      return reply.code(204).send();
    });
  };
}
