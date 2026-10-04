import { and, asc, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Ctx } from "../ctx.js";
import { groups, users } from "../schema.js";
import { parse } from "./core.js";

const lookupQuery = z.object({ email: z.email().max(254) });

/**
 * A minimal directory so people can share material with each other. It reveals only what sharing needs:
 * an exact email match returns an id and display name, never lists users. Groups are listed by name.
 */
export function directoryRoutes(ctx: Ctx) {
  const { db, limit } = ctx;
  return async (r: FastifyInstance) => {
    r.get("/v1/users/lookup", { config: limit }, async (req, reply) => {
      await ctx.authenticateInteractive(req);
      const { email } = parse(lookupQuery, req.query);
      const [u] = await db
        .select({ id: users.id, displayName: users.displayName })
        .from(users)
        .where(and(sql`lower(${users.email}) = lower(${email})`, eq(users.status, "active")));
      if (!u) return reply.code(404).send({ error: "not_found" });
      return u;
    });

    r.get("/v1/groups", async (req) => {
      await ctx.authenticateInteractive(req);
      return db.select({ id: groups.id, name: groups.name }).from(groups).orderBy(asc(groups.name)).limit(500);
    });
  };
}
