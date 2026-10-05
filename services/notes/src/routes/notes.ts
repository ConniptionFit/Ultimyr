import { HttpError, idParam, parse } from "@ultimyr/service-kit";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { DEFAULT_PREFS, type Ctx } from "../ctx.js";
import { FnsError } from "../fns.js";
import { parseFlashcards } from "../flashcards.js";
import { cleanRoot, indexPath, obsidianUrl, planNotes } from "../plan.js";

const tokenField = z.string().min(8).max(2000);
const connectBody = z.strictObject({ token: tokenField, vault: z.string().min(1).max(200) });
const checkBody = z.strictObject({ token: tokenField });
const saveBody = z.strictObject({ content: z.string().max(200_000), baseHash: z.string().max(200) });
const appendBody = z.strictObject({ text: z.string().min(1).max(20_000) });
const statusBody = z.strictObject({ status: z.enum(["todo", "reading", "done"]) });
const prefsBody = z.strictObject({
  rootFolder: z.string().max(200).optional(),
  editor: z.enum(["ultimyr", "obsidian"]).optional(),
  pane: z.enum(["split", "full", "off"]).optional(),
});
const adminBody = z.strictObject({ fnsUrl: z.string().max(500).nullable() });

const MAX_NOTES = 400;

/** Maps what Fast Note Sync says into errors the web app can show. */
function mapFns(e: unknown): never {
  if (e instanceof FnsError) {
    if (e.status === 503) throw new HttpError(502, "fns_unreachable");
    if (e.status === 401) throw new HttpError(409, "fns_token_rejected");
    throw new HttpError(409, "conflict", { message: e.message });
  }
  throw e;
}

/** An administrator's address: http or https, no credentials, no query. Returned without a trailing slash. */
export function cleanServerUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new HttpError(400, "invalid_address");
  }
  if ((u.protocol !== "http:" && u.protocol !== "https:") || u.username || u.password || u.search || u.hash) throw new HttpError(400, "invalid_address");
  return `${u.origin}${u.pathname}`.replace(/\/+$/, "");
}

export function noteRoutes(ctx: Ctx, probe: (url: string) => Promise<boolean>) {
  const { pool } = ctx;

  /** The configured server and master key, or 503 saying which is missing. */
  async function on() {
    const reason = await ctx.offReason();
    if (reason) throw new HttpError(503, "notes_disabled", { reason });
  }

  async function stepRow(userId: string, stepId: string) {
    const { rows } = await pool.query("SELECT path, archive_id FROM notes.step_notes WHERE user_id = $1 AND step_id = $2", [userId, stepId]);
    if (!rows[0]) throw new HttpError(404, "no_note");
    return rows[0] as { path: string; archive_id: string };
  }

  return async (r: FastifyInstance) => {
    // A missing table means the notes migration has not run. Say so plainly instead of a bare "internal error".
    r.setErrorHandler((err: Error & { code?: string; validation?: unknown; statusCode?: number }, req, reply) => {
      if (err instanceof HttpError) return reply.code(err.status).send({ error: err.code, ...err.extra });
      if (err.validation) return reply.code(400).send({ error: "invalid_request" });
      if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.message });
      req.log.error(err);
      if (err.code === "42P01" || err.code === "3F000") return reply.code(503).send({ error: "notes_not_migrated" });
      return reply.code(500).send({ error: "internal_error" });
    });

    // ---- the administrator's one setting: where the Fast Note Sync server is ----
    r.get("/v1/notes/admin", async (req) => {
      await ctx.actor(req, true);
      const server = await ctx.server();
      return { fnsUrl: server?.url ?? null, source: server?.source ?? null, keyPresent: !!ctx.sealer, canEdit: server?.source !== "env" };
    });

    r.put("/v1/notes/admin", async (req) => {
      const a = await ctx.actor(req, true);
      const b = parse(adminBody, req.body);
      const current = await ctx.server();
      if (current?.source === "env") throw new HttpError(409, "set_by_environment");
      if (b.fnsUrl === null || b.fnsUrl.trim() === "") {
        await pool.query("DELETE FROM notes.instance_settings WHERE key = 'fns_url'");
        return { fnsUrl: null };
      }
      const url = cleanServerUrl(b.fnsUrl);
      if (!(await probe(url))) throw new HttpError(400, "server_unreachable");
      await pool.query(
        `INSERT INTO notes.instance_settings (key, value, updated_by) VALUES ('fns_url', $1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [url, a.userId],
      );
      return { fnsUrl: url };
    });

    // ---- this person's connection and preferences ----
    r.get("/v1/notes/connection", async (req) => {
      const a = await ctx.actor(req);
      const reason = await ctx.offReason();
      const server = await ctx.server();
      const { rows } = await pool.query("SELECT vault FROM notes.connections WHERE user_id = $1", [a.userId]);
      return {
        enabled: !reason,
        reason,
        server: server ? new URL(server.url).host : null,
        connected: !!rows[0],
        vault: rows[0]?.vault ?? null,
        admin: a.admin,
        prefs: await ctx.prefs(a.userId),
      };
    });

    /** Checks a pasted token and lists the vaults it can see, so the person picks one instead of typing its name. */
    r.post("/v1/notes/connection/check", async (req) => {
      await ctx.actor(req);
      await on();
      const b = parse(checkBody, req.body);
      try {
        return { vaults: await (await ctx.server())!.fns.vaults(b.token) };
      } catch (e) {
        mapFns(e);
      }
    });

    r.put("/v1/notes/connection", async (req) => {
      const a = await ctx.actor(req);
      await on();
      const b = parse(connectBody, req.body);
      let vaults: string[];
      try {
        vaults = await (await ctx.server())!.fns.vaults(b.token);
      } catch (e) {
        mapFns(e);
      }
      if (!vaults.includes(b.vault)) throw new HttpError(400, "vault_not_found", { vaults });
      await pool.query(
        `INSERT INTO notes.connections (user_id, vault, sealed_token) VALUES ($1,$2,$3)
         ON CONFLICT (user_id) DO UPDATE SET vault = EXCLUDED.vault, sealed_token = EXCLUDED.sealed_token, updated_at = now()`,
        [a.userId, b.vault, ctx.sealer!.seal(a.userId, b.token)],
      );
      return { connected: true, vault: b.vault };
    });

    r.delete("/v1/notes/connection", async (req, reply) => {
      const a = await ctx.actor(req);
      await pool.query("DELETE FROM notes.connections WHERE user_id = $1", [a.userId]);
      // The mapping goes too: it points into a vault we can no longer reach. Notes already in the vault stay untouched.
      await pool.query("DELETE FROM notes.step_notes WHERE user_id = $1", [a.userId]);
      reply.code(204);
    });

    r.get("/v1/notes/preferences", async (req) => ctx.prefs((await ctx.actor(req)).userId));

    r.put("/v1/notes/preferences", async (req) => {
      const a = await ctx.actor(req);
      const b = parse(prefsBody, req.body);
      const cur = await ctx.prefs(a.userId);
      const next = { rootFolder: b.rootFolder === undefined ? cur.rootFolder : cleanRoot(b.rootFolder), editor: b.editor ?? cur.editor, pane: b.pane ?? cur.pane };
      await pool.query(
        `INSERT INTO notes.preferences (user_id, root_folder, editor, pane) VALUES ($1,$2,$3,$4)
         ON CONFLICT (user_id) DO UPDATE SET root_folder = EXCLUDED.root_folder, editor = EXCLUDED.editor, pane = EXCLUDED.pane, updated_at = now()`,
        [a.userId, next.rootFolder, next.editor, next.pane],
      );
      return next;
    });

    /** Folders that already exist in the vault (down to three levels), to suggest as the home for Ultimyr's notes. */
    r.get("/v1/notes/folders", async (req) => {
      const a = await ctx.actor(req);
      await on();
      const conn = await ctx.connection(a.userId);
      let paths: string[];
      try {
        paths = await conn.fns.listPaths(conn.token, conn.vault);
      } catch (e) {
        mapFns(e);
      }
      const folders = new Set<string>();
      for (const p of paths) {
        const parts = p.split("/").slice(0, -1);
        for (let i = 1; i <= Math.min(parts.length, 3); i++) folders.add(parts.slice(0, i).join("/"));
      }
      return { folders: [...folders].sort((x, y) => x.localeCompare(y)).slice(0, 300), default: DEFAULT_PREFS.rootFolder };
    });

    // ---- an archive's notes: what would be made, and making it ----
    r.get("/v1/notes/archives/:id", async (req) => {
      const a = await ctx.actor(req);
      const archiveId = idParam(req);
      const { rows } = await pool.query("SELECT step_id, path FROM notes.step_notes WHERE user_id = $1 AND archive_id = $2", [a.userId, archiveId]);
      const { rows: c } = await pool.query("SELECT vault FROM notes.connections WHERE user_id = $1", [a.userId]);
      const vault = c[0]?.vault as string | undefined;
      const reason = await ctx.offReason();
      return {
        enabled: !reason,
        connected: !!vault,
        scaffolded: rows.length > 0,
        prefs: await ctx.prefs(a.userId),
        steps: Object.fromEntries(rows.map((x) => [x.step_id, { path: x.path, obsidianUrl: vault ? obsidianUrl(vault, x.path) : null }])),
      };
    });

    /** The file tree that Create notes would make for this archive, in the person's chosen folder. Writes nothing. */
    r.get("/v1/notes/archives/:id/preview", async (req) => {
      const a = await ctx.actor(req);
      const archiveId = idParam(req);
      const q = parse(z.object({ root: z.string().max(200).optional() }), req.query);
      const plan = await ctx.content.plan(a.bearer, archiveId);
      if (!plan) throw new HttpError(404, "not_found");
      const root = q.root === undefined ? (await ctx.prefs(a.userId)).rootFolder : cleanRoot(q.root);
      const notes = planNotes(plan, root);
      return { root, total: notes.length, truncated: notes.length > MAX_NOTES, notes: notes.slice(0, MAX_NOTES).map((n) => ({ path: n.path, title: n.title, kind: n.kind })) };
    });

    r.post("/v1/notes/archives/:id/scaffold", async (req) => {
      const a = await ctx.actor(req);
      await on();
      const archiveId = idParam(req);
      const conn = await ctx.connection(a.userId);
      const plan = await ctx.content.plan(a.bearer, archiveId);
      if (!plan) throw new HttpError(404, "not_found");
      const prefs = await ctx.prefs(a.userId);
      const notes = planNotes(plan, prefs.rootFolder);
      if (notes.length > MAX_NOTES) throw new HttpError(400, "too_many_notes", { max: MAX_NOTES });

      let created = 0;
      let existing = 0;
      const failed: string[] = [];
      for (const n of notes) {
        try {
          await conn.fns.createNote(conn.token, conn.vault, n.path, n.content);
          created++;
        } catch (e) {
          if (e instanceof FnsError && (e.status === 503 || e.status === 401)) mapFns(e);
          // createOnly refuses an existing note. Confirm that is why, so a real failure is not mistaken for "already there".
          const found = await conn.fns.getNote(conn.token, conn.vault, n.path).catch(() => null);
          if (found) existing++;
          else {
            failed.push(n.path);
            continue;
          }
        }
        if (n.stepId) {
          await pool.query(
            `INSERT INTO notes.step_notes (user_id, step_id, archive_id, path) VALUES ($1,$2,$3,$4)
             ON CONFLICT (user_id, step_id) DO UPDATE SET path = EXCLUDED.path, archive_id = EXCLUDED.archive_id`,
            [a.userId, n.stepId, archiveId, n.path],
          );
        }
      }
      return { total: notes.length, created, existing, failed, root: prefs.rootFolder, indexUrl: obsidianUrl(conn.vault, indexPath(plan.slug, prefs.rootFolder)) };
    });

    // ---- one step's note ----
    r.get("/v1/notes/steps/:id", async (req) => {
      const a = await ctx.actor(req);
      await on();
      const row = await stepRow(a.userId, idParam(req));
      const conn = await ctx.connection(a.userId);
      let note;
      try {
        note = await conn.fns.getNote(conn.token, conn.vault, row.path);
      } catch (e) {
        mapFns(e);
      }
      return { path: row.path, exists: !!note, content: note?.content ?? "", hash: note?.hash ?? "", obsidianUrl: obsidianUrl(conn.vault, row.path) };
    });

    r.put("/v1/notes/steps/:id", async (req) => {
      const a = await ctx.actor(req);
      await on();
      const row = await stepRow(a.userId, idParam(req));
      const b = parse(saveBody, req.body);
      const conn = await ctx.connection(a.userId);
      try {
        const hash = await conn.fns.saveNote(conn.token, conn.vault, row.path, b.content, b.baseHash);
        return { path: row.path, hash };
      } catch (e) {
        mapFns(e);
      }
    });

    /** Adds text to the end of the note under the person's hand-written text; never replaces anything. */
    r.post("/v1/notes/steps/:id/append", async (req) => {
      const a = await ctx.actor(req);
      await on();
      const row = await stepRow(a.userId, idParam(req));
      const b = parse(appendBody, req.body);
      const conn = await ctx.connection(a.userId);
      try {
        const cur = await conn.fns.getNote(conn.token, conn.vault, row.path);
        if (!cur) throw new HttpError(404, "no_note");
        const content = `${cur.content.replace(/\s+$/, "")}\n\n${b.text.trim()}\n`;
        const hash = await conn.fns.saveNote(conn.token, conn.vault, row.path, content, cur.hash);
        return { path: row.path, hash };
      } catch (e) {
        mapFns(e);
      }
    });

    /** The `Question :: Answer` lines under `## Flashcards`, ready to become a deck. */
    r.get("/v1/notes/steps/:id/flashcards", async (req) => {
      const a = await ctx.actor(req);
      await on();
      const row = await stepRow(a.userId, idParam(req));
      const conn = await ctx.connection(a.userId);
      try {
        const note = await conn.fns.getNote(conn.token, conn.vault, row.path);
        if (!note) throw new HttpError(404, "no_note");
        return { path: row.path, ...parseFlashcards(note.content) };
      } catch (e) {
        mapFns(e);
      }
    });

    /** Only the `status` property changes: the body of the note is never touched by a tick. */
    r.post("/v1/notes/steps/:id/status", async (req) => {
      const a = await ctx.actor(req);
      await on();
      const row = await stepRow(a.userId, idParam(req));
      const b = parse(statusBody, req.body);
      const conn = await ctx.connection(a.userId);
      try {
        await conn.fns.patchFrontmatter(conn.token, conn.vault, row.path, { status: b.status });
      } catch (e) {
        mapFns(e);
      }
      return { path: row.path, status: b.status };
    });
  };
}
