import { HttpError, type Pool, type Service } from "@ultimyr/service-kit";
import type { FastifyRequest } from "fastify";
import type { ContentReader } from "./content.js";
import type { Fns } from "./fns.js";
import type { Sealer } from "./seal.js";

export interface Actor {
  userId: string;
  bearer: string;
}

export interface Ctx {
  svc: Service;
  pool: Pool;
  content: ContentReader;
  fns: Fns | null;
  sealer: Sealer | null;
  fnsHost: string | null;
  actor(req: FastifyRequest): Promise<Actor>;
  /** The caller's connection with the token opened, or a clear error. */
  connection(userId: string): Promise<{ token: string; vault: string }>;
}

export function createCtx(svc: Service, pool: Pool, content: ContentReader, fns: Fns | null, sealer: Sealer | null, fnsHost: string | null): Ctx {
  return {
    svc,
    pool,
    content,
    fns,
    sealer,
    fnsHost,
    async actor(req) {
      const principal = await svc.authorize(req, "notes:use");
      return { userId: principal.userId, bearer: req.headers.authorization!.slice(7) };
    },
    async connection(userId) {
      if (!fns || !sealer) throw new HttpError(503, "notes_disabled");
      const { rows } = await pool.query("SELECT vault, sealed_token FROM notes.connections WHERE user_id = $1", [userId]);
      if (!rows[0]) throw new HttpError(409, "not_connected");
      let token: string;
      try {
        token = sealer.open(userId, rows[0].sealed_token);
      } catch {
        throw new HttpError(409, "connection_unreadable");
      }
      return { token, vault: rows[0].vault };
    },
  };
}
