import { hasRole } from "@ultimyr/authz";
import { HttpError, type Pool, type Service } from "@ultimyr/service-kit";
import type { FastifyRequest } from "fastify";
import type { ContentReader } from "./content.js";
import type { Fns } from "./fns.js";
import { cleanRoot } from "./plan.js";
import type { Sealer } from "./seal.js";

export interface Actor {
  userId: string;
  bearer: string;
  admin: boolean;
}

/** Why notes cannot be used right now, in the words the web app turns into a next step. */
export type OffReason = "no_server" | "no_key";

export interface Server {
  fns: Fns;
  url: string;
  /** `env`: set in the environment, read only. `admin`: set in the admin panel. */
  source: "env" | "admin";
}

export interface Prefs {
  rootFolder: string;
  editor: "ultimyr" | "obsidian";
  pane: "split" | "full" | "off";
}
export const DEFAULT_PREFS: Prefs = { rootFolder: "Ultimyr", editor: "ultimyr", pane: "split" };

export interface Ctx {
  svc: Service;
  pool: Pool;
  content: ContentReader;
  sealer: Sealer | null;
  actor(req: FastifyRequest, adminOnly?: boolean): Promise<Actor>;
  /** The Fast Note Sync server to talk to, or null when none is set. */
  server(): Promise<Server | null>;
  /** Null when notes work, otherwise why not. */
  offReason(): Promise<OffReason | null>;
  /** The caller's connection with the token opened, or a clear error. */
  connection(userId: string): Promise<{ token: string; vault: string; fns: Fns }>;
  prefs(userId: string): Promise<Prefs>;
}

export interface CtxDeps {
  svc: Service;
  pool: Pool;
  content: ContentReader;
  sealer: Sealer | null;
  envUrl: string | null;
  makeFns: (url: string) => Fns;
}

export function createCtx(d: CtxDeps): Ctx {
  const { svc, pool, sealer } = d;
  const ctx: Ctx = {
    svc,
    pool,
    content: d.content,
    sealer,
    async actor(req, adminOnly = false) {
      const principal = await svc.authorize(req, "notes:use");
      const admin = hasRole(principal, "platform_admin");
      if (adminOnly && !admin) throw new HttpError(403, "forbidden");
      return { userId: principal.userId, bearer: req.headers.authorization!.slice(7), admin };
    },
    async server() {
      if (d.envUrl) return { fns: d.makeFns(d.envUrl), url: d.envUrl, source: "env" };
      const { rows } = await pool.query("SELECT value FROM notes.instance_settings WHERE key = 'fns_url'");
      return rows[0] ? { fns: d.makeFns(rows[0].value), url: rows[0].value as string, source: "admin" } : null;
    },
    async offReason() {
      if (!sealer) return "no_key";
      return (await ctx.server()) ? null : "no_server";
    },
    async connection(userId) {
      if (!sealer) throw new HttpError(503, "notes_disabled", { reason: "no_key" });
      const server = await ctx.server();
      if (!server) throw new HttpError(503, "notes_disabled", { reason: "no_server" });
      const { rows } = await pool.query("SELECT vault, sealed_token FROM notes.connections WHERE user_id = $1", [userId]);
      if (!rows[0]) throw new HttpError(409, "not_connected");
      let token: string;
      try {
        token = sealer.open(userId, rows[0].sealed_token);
      } catch {
        throw new HttpError(409, "connection_unreadable");
      }
      return { token, vault: rows[0].vault, fns: server.fns };
    },
    async prefs(userId) {
      const { rows } = await pool.query("SELECT root_folder, editor, pane FROM notes.preferences WHERE user_id = $1", [userId]);
      return rows[0] ? { rootFolder: cleanRoot(rows[0].root_folder), editor: rows[0].editor, pane: rows[0].pane } : { ...DEFAULT_PREFS };
    },
  };
  return ctx;
}
