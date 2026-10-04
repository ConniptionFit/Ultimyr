import { HttpError, idParam, parse } from "@ultimyr/service-kit";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Ctx } from "../ctx.js";
import { FnsError } from "../fns.js";
import { parseFlashcards } from "../flashcards.js";
import { indexPath, obsidianUrl, planNotes } from "../plan.js";

const connectBody = z.strictObject({ token: z.string().min(8).max(2000), vault: z.string().min(1).max(200) });
const saveBody = z.strictObject({ content: z.string().max(200_000), baseHash: z.string().max(200) });
const appendBody = z.strictObject({ text: z.string().min(1).max(20_000) });
const statusBody = z.strictObject({ status: z.enum(["todo", "reading", "done"]) });

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

export function noteRoutes(ctx: Ctx) {
  const { pool } = ctx;
  const on = () => {
    if (!ctx.fns || !ctx.sealer) throw new HttpError(503, "notes_disabled");
    return ctx.fns;
  };

  async function stepRow(userId: string, stepId: string) {
    const { rows } = await pool.query("SELECT path, archive_id FROM notes.step_notes WHERE user_id = $1 AND step_id = $2", [userId, stepId]);
    if (!rows[0]) throw new HttpError(404, "no_note");
    return rows[0] as { path: string; archive_id: string };
  }

  return async (r: FastifyInstance) => {
    r.get("/v1/notes/connection", async (req) => {
      const a = await ctx.actor(req);
      const enabled = !!ctx.fns && !!ctx.sealer;
      const { rows } = await pool.query("SELECT vault FROM notes.connections WHERE user_id = $1", [a.userId]);
      return { enabled, server: enabled ? ctx.fnsHost : null, connected: !!rows[0], vault: rows[0]?.vault ?? null };
    });

    r.put("/v1/notes/connection", async (req) => {
      const a = await ctx.actor(req);
      const fns = on();
      const b = parse(connectBody, req.body);
      let vaults: string[];
      try {
        vaults = await fns.vaults(b.token);
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

    r.get("/v1/notes/archives/:id", async (req) => {
      const a = await ctx.actor(req);
      const archiveId = idParam(req);
      const { rows } = await pool.query("SELECT step_id, path FROM notes.step_notes WHERE user_id = $1 AND archive_id = $2", [a.userId, archiveId]);
      const { rows: c } = await pool.query("SELECT vault FROM notes.connections WHERE user_id = $1", [a.userId]);
      const vault = c[0]?.vault as string | undefined;
      return {
        enabled: !!ctx.fns && !!ctx.sealer,
        connected: !!vault,
        scaffolded: rows.length > 0,
        steps: Object.fromEntries(rows.map((x) => [x.step_id, { path: x.path, obsidianUrl: vault ? obsidianUrl(vault, x.path) : null }])),
      };
    });

    r.post("/v1/notes/archives/:id/scaffold", async (req) => {
      const a = await ctx.actor(req);
      const fns = on();
      const archiveId = idParam(req);
      const conn = await ctx.connection(a.userId);
      const plan = await ctx.content.plan(a.bearer, archiveId);
      if (!plan) throw new HttpError(404, "not_found");
      const notes = planNotes(plan);
      if (notes.length > MAX_NOTES) throw new HttpError(400, "too_many_notes", { max: MAX_NOTES });

      let created = 0;
      let existing = 0;
      const failed: string[] = [];
      for (const n of notes) {
        try {
          await fns.createNote(conn.token, conn.vault, n.path, n.content);
          created++;
        } catch (e) {
          if (e instanceof FnsError && e.status === 503) mapFns(e);
          if (e instanceof FnsError && e.status === 401) mapFns(e);
          // createOnly refuses an existing note. Confirm that is why, so a real failure is not mistaken for "already there".
          const found = await fns.getNote(conn.token, conn.vault, n.path).catch(() => null);
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
      return { total: notes.length, created, existing, failed, indexUrl: obsidianUrl(conn.vault, indexPath(plan.slug)) };
    });

    r.get("/v1/notes/steps/:id", async (req) => {
      const a = await ctx.actor(req);
      const fns = on();
      const row = await stepRow(a.userId, idParam(req));
      const conn = await ctx.connection(a.userId);
      let note;
      try {
        note = await fns.getNote(conn.token, conn.vault, row.path);
      } catch (e) {
        mapFns(e);
      }
      return { path: row.path, exists: !!note, content: note?.content ?? "", hash: note?.hash ?? "", obsidianUrl: obsidianUrl(conn.vault, row.path) };
    });

    r.put("/v1/notes/steps/:id", async (req) => {
      const a = await ctx.actor(req);
      const fns = on();
      const row = await stepRow(a.userId, idParam(req));
      const b = parse(saveBody, req.body);
      const conn = await ctx.connection(a.userId);
      try {
        const hash = await fns.saveNote(conn.token, conn.vault, row.path, b.content, b.baseHash);
        return { path: row.path, hash };
      } catch (e) {
        mapFns(e);
      }
    });

    /** Adds text to the end of the note under the person's hand-written text; never replaces anything. */
    r.post("/v1/notes/steps/:id/append", async (req) => {
      const a = await ctx.actor(req);
      const fns = on();
      const row = await stepRow(a.userId, idParam(req));
      const b = parse(appendBody, req.body);
      const conn = await ctx.connection(a.userId);
      try {
        const cur = await fns.getNote(conn.token, conn.vault, row.path);
        if (!cur) throw new HttpError(404, "no_note");
        const content = `${cur.content.replace(/\s+$/, "")}\n\n${b.text.trim()}\n`;
        const hash = await fns.saveNote(conn.token, conn.vault, row.path, content, cur.hash);
        return { path: row.path, hash };
      } catch (e) {
        mapFns(e);
      }
    });

    /** The `Question :: Answer` lines under `## Flashcards`, ready to become a deck. */
    r.get("/v1/notes/steps/:id/flashcards", async (req) => {
      const a = await ctx.actor(req);
      const fns = on();
      const row = await stepRow(a.userId, idParam(req));
      const conn = await ctx.connection(a.userId);
      try {
        const note = await fns.getNote(conn.token, conn.vault, row.path);
        if (!note) throw new HttpError(404, "no_note");
        return { path: row.path, ...parseFlashcards(note.content) };
      } catch (e) {
        mapFns(e);
      }
    });

    /** Only the `status` property changes: the body of the note is never touched by a tick. */
    r.post("/v1/notes/steps/:id/status", async (req) => {
      const a = await ctx.actor(req);
      const fns = on();
      const row = await stepRow(a.userId, idParam(req));
      const b = parse(statusBody, req.body);
      const conn = await ctx.connection(a.userId);
      try {
        await fns.patchFrontmatter(conn.token, conn.vault, row.path, { status: b.status });
      } catch (e) {
        mapFns(e);
      }
      return { path: row.path, status: b.status };
    });
  };
}
