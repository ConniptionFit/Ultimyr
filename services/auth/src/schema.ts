import { bigserial, jsonb, pgSchema, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const auth = pgSchema("auth");

export const users = auth.table("users", {
  id: uuid("id").primaryKey(),
  email: text("email").notNull(),
  displayName: text("display_name").notNull(),
  passwordHash: text("password_hash"),
  status: text("status").notNull().default("active"),
  createdVia: text("created_via").notNull().default("local"),
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
  userAgent: text("user_agent"),
  ip: text("ip"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
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
