import { hasRole } from "@ultimyr/authz";
import { HttpError, type Pool, type Principal, type Service } from "@ultimyr/service-kit";
import type { FastifyRequest } from "fastify";
import type { AccessChecker, ItemAccess } from "./access.js";

export interface Actor {
  userId: string;
  principal: Principal;
  bearer: string;
}

export interface Ctx {
  svc: Service;
  pool: Pool;
  now(): Date;
  actor(req: FastifyRequest, scope: "quiz:read" | "quiz:write"): Promise<Actor>;
  /** The quiz item, if the caller may reach it at all. Unknown and forbidden both read as 404. */
  quizItem(a: Actor, itemId: string, need: "attempt" | "write"): Promise<ItemAccess>;
  isAuthor(a: Actor): boolean;
}

export function createCtx(svc: Service, pool: Pool, access: AccessChecker, now: () => Date): Ctx {
  return {
    svc,
    pool,
    now,
    async actor(req, scope) {
      const principal = await svc.authorize(req, scope);
      return { userId: principal.userId, principal, bearer: req.headers.authorization!.slice(7) };
    },
    async quizItem(a, itemId, need) {
      const it = await access.item(a.bearer, itemId);
      if (!it || it.kind !== "quiz" || (need === "attempt" ? !it.canAttempt : !it.canWrite)) throw new HttpError(404, "not_found");
      return it;
    },
    isAuthor: (a) => hasRole(a.principal, "author", "org_admin", "platform_admin"),
  };
}
