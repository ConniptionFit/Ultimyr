import { HttpError, idParam, parse } from "@ultimyr/service-kit";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { DEFAULT_PREFS, type Ctx } from "../ctx.js";
import { FnsError } from "../fns.js";
import { parseFlashcards } from "../flashcards.js";
import { splitFile } from "../files.js";
import { resolve as resolveConflict, saveLocal, syncOne, type Conn, type NoteView, type Target } from "../mirror.js";
import { cleanRoot, indexPath, obsidianUrl, planNotes } from "../plan.js";

const tokenField = z.string().min(8).max(2000);
const connectBody = z.strictObject({ token: tokenField, vault: z.string().min(1).max(200) });
const checkBody = z.strictObject({ token: tokenField });
const archiveField = z.uuid().optional();
const stepQuery = z.object({ archive: archiveField });
const saveBody = z.strictObject({ content: z.string().max(200_000), baseHash: z.string().max(200), archive: archiveField });
const appendBody = z.strictObject({ text: z.string().min(1).max(20_000), archive: archiveField });
const statusBody = z.strictObject({ status: z.enum(["todo", "reading", "done"]), archive: archiveField });
const resolveBody = z.strictObject({ keep: z.enum(["mine", "obsidian"]), archive: archiveField });
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

  /** The vault connection when there is one that works. Notes themselves never need it. */
  async function mirror(userId: string): Promise<Conn | null> {
    const { rows } = await pool.query("SELECT 1 FROM notes.connections WHERE user_id = $1", [userId]);
    if (!rows[0] || (await ctx.offReason())) return null;
    try {
      return await ctx.connection(userId);
    } catch (e) {
      if (e instanceof HttpError) return null;
      throw e;
    }
  }

  /** Which archive a step belongs to (from the request, or from the note already saved) and where its file goes in the vault. */
  async function locate(a: { userId: string; bearer: string }, stepId: string, archive: string | undefined): Promise<{ archiveId: string; target: Target; title: string }> {
    let archiveId = archive;
    if (!archiveId) {
      const { rows } = await pool.query("SELECT archive_id FROM notes.step_text WHERE user_id = $1 AND step_id = $2", [a.userId, stepId]);
      archiveId = rows[0]?.archive_id as string | undefined;
    }
    if (!archiveId) throw new HttpError(400, "archive_required");
    const plan = await ctx.content.plan(a.bearer, archiveId);
    if (!plan) throw new HttpError(404, "not_found");
    const planned = planNotes(plan, (await ctx.prefs(a.userId)).rootFolder).find((n) => n.stepId === stepId);
    if (!planned) throw new HttpError(404, "not_found");
    return { archiveId, target: { path: planned.path, prefix: splitFile(planned.content).prefix }, title: planned.title };
  }

  const view = (v: NoteView, conn: Conn | null, path: string) => ({
    exists: v.exists,
    content: v.content,
    hash: v.hash,
    mirror: v.state,
    ...(v.remote !== undefined ? { remote: v.remote } : {}),
    ...(v.pulled ? { pulled: true } : {}),
    obsidianUrl: conn ? obsidianUrl(conn.vault, path) : null,
  });

  return async (r: FastifyInstance) => {
    // A missing table means the notes migration has not run. Say so plainly instead of a bare "internal error".
    r.setErrorHandler((err: Error & { code?: string; validation?: unknown; statusCode?: number }, req, reply) => {
      if (err instanceof HttpError) return reply.code(err.status).send({ error: err.code, ...err.extra });
      if (err.validation) return reply.code(400).send({ error: "invalid_request" });
      if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.message });
      req.log.error({ err, ref: req.id }, "notes error");
      if (err.code === "42P01" || err.code === "3F000") return reply.code(503).send({ error: "notes_not_migrated", ref: req.id });
      if (err.code && /^(ECONNREFUSED|ENOTFOUND|ETIMEDOUT|57P0\d|08\w+|28\w+)$/.test(err.code)) return reply.code(503).send({ error: "notes_db_unavailable", ref: req.id });
      return reply.code(500).send({ error: "internal_error", ref: req.id });
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
      // Notes stay in Ultimyr; forget what was in step so a later connection starts from a clean comparison.
      await pool.query("UPDATE notes.step_text SET pushed_hash = NULL, remote_hash = NULL WHERE user_id = $1", [a.userId]);
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
    /** Which steps of an archive have a note, for the little marker on each step. */
    r.get("/v1/notes/archives/:id", async (req) => {
      const a = await ctx.actor(req);
      const archiveId = idParam(req);
      const { rows } = await pool.query(
        `SELECT t.step_id, (length(trim(t.content)) > 0) AS has_text, n.path FROM notes.step_text t
         LEFT JOIN notes.step_notes n ON n.user_id = t.user_id AND n.step_id = t.step_id
         WHERE t.user_id = $1 AND t.archive_id = $2`,
        [a.userId, archiveId],
      );
      const { rows: c } = await pool.query("SELECT vault FROM notes.connections WHERE user_id = $1", [a.userId]);
      const vault = c[0]?.vault as string | undefined;
      const reason = await ctx.offReason();
      return {
        mirrorAvailable: !reason,
        connected: !!vault && !reason,
        prefs: await ctx.prefs(a.userId),
        steps: Object.fromEntries(rows.filter((x) => x.has_text).map((x) => [x.step_id, { path: x.path ?? null, obsidianUrl: vault && x.path ? obsidianUrl(vault, x.path) : null }])),
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

    // ---- one step's note: kept in Ultimyr, mirrored to the vault when it is connected ----
    r.get("/v1/notes/steps/:id", async (req) => {
      const a = await ctx.actor(req);
      const stepId = idParam(req);
      const q = parse(stepQuery, req.query);
      const loc = await locate(a, stepId, q.archive);
      const conn = await mirror(a.userId);
      return { ...view(await syncOne(pool, a.userId, stepId, loc.archiveId, loc.target, conn), conn, loc.target.path), path: loc.target.path };
    });

    r.put("/v1/notes/steps/:id", async (req) => {
      const a = await ctx.actor(req);
      const stepId = idParam(req);
      const b = parse(saveBody, req.body);
      const loc = await locate(a, stepId, b.archive);
      const { rows } = await pool.query("SELECT hash FROM notes.step_text WHERE user_id = $1 AND step_id = $2", [a.userId, stepId]);
      // Saved from an out of date screen (another tab, or a sync took in new text): refuse rather than overwrite.
      if (rows[0] && rows[0].hash !== b.baseHash) throw new HttpError(409, "conflict");
      await saveLocal(pool, a.userId, stepId, loc.archiveId, b.content);
      const conn = await mirror(a.userId);
      return view(await syncOne(pool, a.userId, stepId, loc.archiveId, loc.target, conn), conn, loc.target.path);
    });

    /** Adds text to the end of the note under the person's hand-written text; never replaces anything. */
    r.post("/v1/notes/steps/:id/append", async (req) => {
      const a = await ctx.actor(req);
      const stepId = idParam(req);
      const b = parse(appendBody, req.body);
      const loc = await locate(a, stepId, b.archive);
      const conn = await mirror(a.userId);
      // Take in anything changed in the vault first, so the text is added to the latest version.
      const cur = await syncOne(pool, a.userId, stepId, loc.archiveId, loc.target, conn);
      if (cur.state === "conflict") throw new HttpError(409, "conflict");
      const content = cur.content.trim() ? `${cur.content.replace(/\s+$/, "")}\n\n${b.text.trim()}\n` : `${b.text.trim()}\n`;
      await saveLocal(pool, a.userId, stepId, loc.archiveId, content);
      return view(await syncOne(pool, a.userId, stepId, loc.archiveId, loc.target, conn), conn, loc.target.path);
    });

    /** Choose which copy wins after both changed. */
    r.post("/v1/notes/steps/:id/resolve", async (req) => {
      const a = await ctx.actor(req);
      const stepId = idParam(req);
      const b = parse(resolveBody, req.body);
      const loc = await locate(a, stepId, b.archive);
      const conn = await mirror(a.userId);
      if (!conn) throw new HttpError(409, "not_connected");
      try {
        return view(await resolveConflict(pool, a.userId, stepId, loc.archiveId, loc.target, conn, b.keep), conn, loc.target.path);
      } catch (e) {
        mapFns(e);
      }
    });

    /** The `Question :: Answer` lines under `## Flashcards`, ready to become a deck. */
    r.get("/v1/notes/steps/:id/flashcards", async (req) => {
      const a = await ctx.actor(req);
      const stepId = idParam(req);
      const { rows } = await pool.query("SELECT content FROM notes.step_text WHERE user_id = $1 AND step_id = $2", [a.userId, stepId]);
      if (!rows[0]) throw new HttpError(404, "no_note");
      return parseFlashcards(rows[0].content as string);
    });

    /** Only the `status` property of the vault copy changes: the text of the note is never touched by a tick. Best effort. */
    r.post("/v1/notes/steps/:id/status", async (req) => {
      const a = await ctx.actor(req);
      const stepId = idParam(req);
      const b = parse(statusBody, req.body);
      const { rows } = await pool.query("SELECT path FROM notes.step_notes WHERE user_id = $1 AND step_id = $2", [a.userId, stepId]);
      const conn = rows[0] ? await mirror(a.userId) : null;
      if (conn) await conn.fns.patchFrontmatter(conn.token, conn.vault, rows[0].path as string, { status: b.status }).catch(() => {});
      return { status: b.status };
    });

    /** Brings every note of this person in step with the vault: writes new text out, takes new vault text in. */
    r.post("/v1/notes/sync", async (req) => {
      const a = await ctx.actor(req);
      await on();
      const conn = await ctx.connection(a.userId);
      const { rows } = await pool.query("SELECT step_id, archive_id FROM notes.step_text WHERE user_id = $1 ORDER BY archive_id, updated_at LIMIT $2", [a.userId, MAX_NOTES]);
      const rootFolder = (await ctx.prefs(a.userId)).rootFolder;
      const byArchive = new Map<string, string[]>();
      for (const x of rows) byArchive.set(x.archive_id, [...(byArchive.get(x.archive_id) ?? []), x.step_id]);
      const out = { total: rows.length, synced: 0, pulled: 0, conflicts: 0, failed: 0 };
      for (const [archiveId, steps] of byArchive) {
        const plan = await ctx.content.plan(a.bearer, archiveId);
        if (!plan) {
          out.failed += steps.length;
          continue;
        }
        const planned = planNotes(plan, rootFolder);
        // The index note is only created if missing, so an index written or edited in Obsidian is left alone.
        const index = planned.find((n) => n.kind === "index");
        if (index) await conn.fns.createNote(conn.token, conn.vault, index.path, index.content).catch(() => {});
        for (const stepId of steps) {
          const n = planned.find((p) => p.stepId === stepId);
          if (!n) {
            out.failed++;
            continue;
          }
          const v = await syncOne(pool, a.userId, stepId, archiveId, { path: n.path, prefix: splitFile(n.content).prefix }, conn);
          if (v.state === "synced") out.synced++;
          else if (v.state === "conflict") out.conflicts++;
          else out.failed++;
          if (v.pulled) out.pulled++;
        }
      }
      return out;
    });
  };
}
