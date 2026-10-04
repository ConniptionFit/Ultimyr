import { bigint, bigserial, boolean, customType, integer, jsonb, pgSchema, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const auth = pgSchema("auth");

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

export const users = auth.table("users", {
  id: uuid("id").primaryKey(),
  email: text("email").notNull(),
  displayName: text("display_name").notNull(),
  passwordHash: text("password_hash"),
  status: text("status").notNull().default("active"),
  createdVia: text("created_via").notNull().default("local"),
  externalId: text("external_id"),
  scimManaged: boolean("scim_managed").notNull().default(false),
  givenName: text("given_name"),
  familyName: text("family_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const roleAssignments = auth.table(
  "role_assignments",
  {
    userId: uuid("user_id").notNull(),
    role: text("role").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.role] })],
);

export const sessions = auth.table("sessions", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  refreshHash: text("refresh_hash").notNull(),
  prevRefreshHash: text("prev_refresh_hash"),
  rotatedAt: timestamp("rotated_at", { withTimezone: true }),
  userAgent: text("user_agent"),
  ip: text("ip"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  amr: text("amr").array().notNull().default(["pwd"]),
});

export const auditLog = auth.table("audit_log", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  actorId: uuid("actor_id"),
  action: text("action").notNull(),
  target: text("target"),
  ip: text("ip"),
  metadata: jsonb("metadata").notNull().default({}),
});

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const totpFactors = auth.table("totp_factors", {
  userId: uuid("user_id").primaryKey(),
  secretEnc: bytea("secret_enc").notNull(),
  confirmedAt: ts("confirmed_at"),
  lastTimeStep: bigint("last_time_step", { mode: "number" }),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  lockedUntil: ts("locked_until"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const recoveryCodes = auth.table("recovery_codes", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: uuid("user_id").notNull(),
  codeHash: text("code_hash").notNull(),
  usedAt: ts("used_at"),
});

export const passkeys = auth.table("passkeys", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  credentialId: text("credential_id").notNull(),
  publicKey: bytea("public_key").notNull(),
  counter: bigint("counter", { mode: "number" }).notNull().default(0),
  transports: text("transports").array(),
  deviceType: text("device_type"),
  backedUp: boolean("backed_up").notNull().default(false),
  name: text("name").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  lastUsedAt: ts("last_used_at"),
});

export const webauthnChallenges = auth.table("webauthn_challenges", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id"),
  purpose: text("purpose").notNull(),
  challenge: text("challenge").notNull(),
  expiresAt: ts("expires_at").notNull(),
});

export const apiKeys = auth.table("api_keys", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  name: text("name").notNull(),
  prefix: text("prefix").notNull(),
  keyHash: text("key_hash").notNull(),
  scopes: text("scopes").array().notNull(),
  expiresAt: ts("expires_at"),
  lastUsedAt: ts("last_used_at"),
  revokedAt: ts("revoked_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const groups = auth.table("groups", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  source: text("source").notNull(),
  externalId: text("external_id"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const groupMembers = auth.table(
  "group_members",
  { groupId: uuid("group_id").notNull(), userId: uuid("user_id").notNull() },
  (t) => [primaryKey({ columns: [t.groupId, t.userId] })],
);

export const idpProviders = auth.table("idp_providers", {
  id: uuid("id").primaryKey(),
  slug: text("slug").notNull(),
  kind: text("kind").notNull(),
  name: text("name").notNull(),
  config: jsonb("config").$type<Record<string, unknown>>().notNull(),
  clientSecretEnc: bytea("client_secret_enc"),
  jitProvisioning: boolean("jit_provisioning").notNull().default(true),
  trustEmail: boolean("trust_email").notNull().default(false),
  groupClaim: text("group_claim"),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const identities = auth.table("identities", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  providerId: uuid("provider_id").notNull(),
  subject: text("subject").notNull(),
  email: text("email"),
  claims: jsonb("claims"),
  createdAt: ts("created_at").notNull().defaultNow(),
  lastLoginAt: ts("last_login_at"),
});

export const ssoStates = auth.table("sso_states", {
  state: text("state").primaryKey(),
  providerId: uuid("provider_id").notNull(),
  nonce: text("nonce"),
  codeVerifier: text("code_verifier"),
  redirectTo: text("redirect_to"),
  expiresAt: ts("expires_at").notNull(),
});

export const scimTokens = auth.table("scim_tokens", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull(),
  createdBy: uuid("created_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
  lastUsedAt: ts("last_used_at"),
  revokedAt: ts("revoked_at"),
});

export const instanceSettings = auth.table("instance_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedBy: uuid("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
