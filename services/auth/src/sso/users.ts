import { and, eq, inArray, like, sql } from "drizzle-orm";
import { uuidv7 } from "../ids.js";
import type { Ctx } from "../ctx.js";
import { groupMembers, groups, identities, idpProviders, roleAssignments, users } from "../schema.js";

export type Provider = typeof idpProviders.$inferSelect;

export interface ExternalProfile {
  subject: string;
  email?: string | undefined;
  emailVerified?: boolean | undefined;
  name?: string | undefined;
  groups?: string[] | undefined;
  claims?: Record<string, unknown> | undefined;
}

export class SsoError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

/** Map an external identity to a local user: existing link, trusted-email link, or just-in-time creation. */
export async function resolveSsoUser(ctx: Ctx, p: Provider, ext: ExternalProfile): Promise<string> {
  const { db } = ctx;
  const email = ext.email?.trim();

  const [link] = await db.select().from(identities).where(and(eq(identities.providerId, p.id), eq(identities.subject, ext.subject)));
  let userId: string;
  if (link) {
    userId = link.userId;
    await db.update(identities).set({ lastLoginAt: new Date(), email: email ?? link.email, claims: ext.claims ?? null }).where(eq(identities.id, link.id));
  } else {
    let existing: { id: string } | undefined;
    if (email) [existing] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = lower(${email})`);
    if (existing) {
      // Linking by email is only safe when the IdP is trusted to have verified it.
      if (!(p.trustEmail && ext.emailVerified === true)) throw new SsoError("account_exists");
      userId = existing.id;
    } else {
      if (!p.jitProvisioning) throw new SsoError("not_provisioned");
      if (!email) throw new SsoError("email_required");
      userId = uuidv7();
      await db.transaction(async (tx) => {
        await tx.insert(users).values({ id: userId, email, displayName: (ext.name || email.split("@")[0]!).slice(0, 80), createdVia: "sso" });
        await tx.insert(roleAssignments).values([{ userId, role: "author" }, { userId, role: "learner" }]);
      });
    }
    await db.insert(identities).values({ id: uuidv7(), userId, providerId: p.id, subject: ext.subject, email: email ?? null, claims: ext.claims ?? null, lastLoginAt: new Date() });
  }

  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user || user.status !== "active") throw new SsoError("account_disabled");
  if (p.groupClaim && ext.groups) await syncGroups(ctx, p, userId, ext.groups);
  return userId;
}

/** Make the user's membership of this provider's groups match what the IdP just asserted. */
async function syncGroups(ctx: Ctx, p: Provider, userId: string, names: string[]) {
  const { db } = ctx;
  const wanted = [...new Set(names.map((n) => String(n).trim()).filter(Boolean))].slice(0, 200);
  const wantedIds: string[] = [];
  for (const name of wanted) {
    const externalId = `${p.id}:${name}`;
    const [g] = await db.select({ id: groups.id }).from(groups).where(and(eq(groups.source, "sso"), eq(groups.externalId, externalId)));
    if (g) wantedIds.push(g.id);
    else {
      const id = uuidv7();
      await db.insert(groups).values({ id, name: `${p.name}: ${name}`.slice(0, 100), source: "sso", externalId }).onConflictDoNothing();
      const [created] = await db.select({ id: groups.id }).from(groups).where(and(eq(groups.source, "sso"), eq(groups.externalId, externalId)));
      if (created) wantedIds.push(created.id);
    }
  }
  const mine = await db
    .select({ id: groups.id })
    .from(groups)
    .where(and(eq(groups.source, "sso"), like(groups.externalId, `${p.id}:%`)));
  const stale = mine.map((g) => g.id).filter((id) => !wantedIds.includes(id));
  if (stale.length) await db.delete(groupMembers).where(and(eq(groupMembers.userId, userId), inArray(groupMembers.groupId, stale)));
  if (wantedIds.length) await db.insert(groupMembers).values(wantedIds.map((groupId) => ({ groupId, userId }))).onConflictDoNothing();
}
