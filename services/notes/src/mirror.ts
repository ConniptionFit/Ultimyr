import type { Pool } from "@ultimyr/service-kit";
import { composeFile, sha, splitFile } from "./files.js";
import { FnsError, type Fns } from "./fns.js";

export type MirrorState = "off" | "synced" | "pending" | "conflict" | "unreachable";

export interface Conn {
  token: string;
  vault: string;
  fns: Fns;
}
/** Where a step's note lives in the vault and the Obsidian properties a new file starts with. */
export interface Target {
  path: string;
  prefix: string;
}
export interface NoteView {
  exists: boolean;
  content: string;
  hash: string;
  state: MirrorState;
  /** The vault's text when it and this copy both changed since they were last in step. */
  remote?: string;
  /** Text changed in the vault was taken in. */
  pulled?: boolean;
}

interface Row {
  content: string;
  hash: string;
  pushed_hash: string | null;
  remote_hash: string | null;
}

async function loadRow(pool: Pool, userId: string, stepId: string): Promise<Row | null> {
  const { rows } = await pool.query("SELECT content, hash, pushed_hash, remote_hash FROM notes.step_text WHERE user_id = $1 AND step_id = $2", [userId, stepId]);
  return (rows[0] as Row | undefined) ?? null;
}

async function remember(pool: Pool, userId: string, stepId: string, archiveId: string, path: string) {
  await pool.query(
    `INSERT INTO notes.step_notes (user_id, step_id, archive_id, path) VALUES ($1,$2,$3,$4)
     ON CONFLICT (user_id, step_id) DO UPDATE SET path = EXCLUDED.path, archive_id = EXCLUDED.archive_id`,
    [userId, stepId, archiveId, path],
  );
}

/** Writes the text kept in Ultimyr (creating the row on first save). The vault is not involved. */
export async function saveLocal(pool: Pool, userId: string, stepId: string, archiveId: string, content: string): Promise<string> {
  const hash = sha(content);
  await pool.query(
    `INSERT INTO notes.step_text (user_id, step_id, archive_id, content, hash) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (user_id, step_id) DO UPDATE SET content = EXCLUDED.content, hash = EXCLUDED.hash, archive_id = EXCLUDED.archive_id, updated_at = now()`,
    [userId, stepId, archiveId, content, hash],
  );
  return hash;
}

/**
 * Brings this copy and the vault copy in step, in both directions, without ever losing text.
 * - changed only in the vault: taken in here
 * - changed only here: written to the vault
 * - changed in both: nothing is overwritten; the vault's text is returned as `remote` for the person to choose
 * Anything that goes wrong with the vault leaves the saved text alone and reports `unreachable`.
 */
export async function syncOne(pool: Pool, userId: string, stepId: string, archiveId: string, target: Target, conn: Conn | null): Promise<NoteView> {
  const row = await loadRow(pool, userId, stepId);
  const local: NoteView = { exists: !!row, content: row?.content ?? "", hash: row?.hash ?? "", state: "off" };
  if (!conn) return local;

  let remote: { content: string; hash: string } | null;
  try {
    remote = await conn.fns.getNote(conn.token, conn.vault, target.path);
  } catch (e) {
    if (e instanceof FnsError) return { ...local, state: "unreachable" };
    throw e;
  }
  const remoteBody = remote ? splitFile(remote.content).body : null;

  if (!row) {
    if (!remote) return { ...local, state: "synced" };
    // A note that already exists in the vault (made earlier, or in Obsidian) becomes this person's note here.
    const hash = sha(remoteBody!);
    await pool.query(
      `INSERT INTO notes.step_text (user_id, step_id, archive_id, content, hash, pushed_hash, remote_hash) VALUES ($1,$2,$3,$4,$5,$5,$6)
       ON CONFLICT (user_id, step_id) DO NOTHING`,
      [userId, stepId, archiveId, remoteBody, hash, remote.hash],
    );
    await remember(pool, userId, stepId, archiveId, target.path);
    return { exists: true, content: remoteBody!, hash, state: "synced", pulled: true };
  }

  const localChanged = row.hash !== row.pushed_hash;
  const remoteChanged = remote ? remote.hash !== row.remote_hash : row.remote_hash !== null;

  if (remote && remoteChanged && remoteBody === row.content) {
    await pool.query("UPDATE notes.step_text SET pushed_hash = $3, remote_hash = $4 WHERE user_id = $1 AND step_id = $2", [userId, stepId, row.hash, remote.hash]);
    await remember(pool, userId, stepId, archiveId, target.path);
    return { ...local, state: "synced" };
  }
  if (remote && remoteChanged && localChanged) return { ...local, state: "conflict", remote: remoteBody! };
  if (remote && remoteChanged) {
    const hash = sha(remoteBody!);
    await pool.query(
      "UPDATE notes.step_text SET content = $3, hash = $4, pushed_hash = $4, remote_hash = $5, updated_at = now() WHERE user_id = $1 AND step_id = $2",
      [userId, stepId, remoteBody, hash, remote.hash],
    );
    await remember(pool, userId, stepId, archiveId, target.path);
    return { exists: true, content: remoteBody!, hash, state: "synced", pulled: true };
  }
  if (!localChanged && remote) {
    await remember(pool, userId, stepId, archiveId, target.path);
    return { ...local, state: "synced" };
  }
  // Only this copy changed (or the vault copy was deleted): write it out.
  if (!row.content.trim() && !remote) return { ...local, state: "synced" };
  try {
    const remoteHash = remote
      ? await conn.fns.saveNote(conn.token, conn.vault, target.path, composeFile(splitFile(remote.content).prefix || target.prefix, row.content), remote.hash)
      : await conn.fns.createNote(conn.token, conn.vault, target.path, composeFile(target.prefix, row.content));
    await pool.query("UPDATE notes.step_text SET pushed_hash = $3, remote_hash = $4 WHERE user_id = $1 AND step_id = $2", [userId, stepId, row.hash, remoteHash]);
    await remember(pool, userId, stepId, archiveId, target.path);
    return { ...local, state: "synced" };
  } catch (e) {
    if (e instanceof FnsError) return { ...local, state: e.status === 503 || e.status === 401 ? "unreachable" : "pending" };
    throw e;
  }
}

/** Resolves a conflict: keep this copy (it replaces the vault's) or take the vault's. */
export async function resolve(pool: Pool, userId: string, stepId: string, archiveId: string, target: Target, conn: Conn, keep: "mine" | "obsidian"): Promise<NoteView> {
  const row = await loadRow(pool, userId, stepId);
  const remote = await conn.fns.getNote(conn.token, conn.vault, target.path);
  if (keep === "obsidian" && remote) {
    const body = splitFile(remote.content).body;
    const hash = await saveLocal(pool, userId, stepId, archiveId, body);
    await pool.query("UPDATE notes.step_text SET pushed_hash = $3, remote_hash = $4 WHERE user_id = $1 AND step_id = $2", [userId, stepId, hash, remote.hash]);
    await remember(pool, userId, stepId, archiveId, target.path);
    return { exists: true, content: body, hash, state: "synced" };
  }
  if (row && remote) {
    // Forget what was last in step so the vault's current text counts as unchanged and ours is written over it.
    await pool.query("UPDATE notes.step_text SET remote_hash = $3 WHERE user_id = $1 AND step_id = $2", [userId, stepId, remote.hash]);
    await pool.query("UPDATE notes.step_text SET pushed_hash = NULL WHERE user_id = $1 AND step_id = $2", [userId, stepId]);
  }
  return syncOne(pool, userId, stepId, archiveId, target, conn);
}
