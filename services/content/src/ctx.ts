import { hasRole } from "@ultimyr/authz";
import { HttpError, type Pool, type Service } from "@ultimyr/service-kit";
import type { FastifyRequest } from "fastify";
import { CURATOR, type Actor, type GroupResolver } from "./access.js";

export interface Ctx {
  svc: Service;
  pool: Pool;
  /** The clock. Tests move it. */
  now(): Date;
  groups: GroupResolver;
  /** Authenticate, check the token scope, and resolve the caller's groups. */
  actor(req: FastifyRequest, scope: "content:read" | "content:write" | "content:share"): Promise<Actor>;
  /** Only authors and admins create new material; learners consume what is shared with them. */
  requireAuthor(a: Actor): void;
}

export function createCtx(svc: Service, pool: Pool, groups: GroupResolver, now: () => Date = () => new Date()): Ctx {
  return {
    svc,
    pool,
    now,
    groups,
    async actor(req, scope) {
      const principal = await svc.authorize(req, scope);
      const bearer = req.headers.authorization!.slice(7);
      const ids = await groups.groupsFor(principal, bearer);
      return { userId: principal.userId, principal, groups: hasRole(principal, "curriculum_admin") ? [...ids, CURATOR] : ids };
    },
    requireAuthor(a) {
      if (!hasRole(a.principal, "author", "curriculum_admin", "org_admin", "platform_admin")) throw new HttpError(403, "forbidden");
    },
  };
}
