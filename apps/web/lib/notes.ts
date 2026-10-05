/** Where each person's notes go, and how they want to work with them. Follows them across devices. */
export interface NotesPrefs {
  rootFolder: string;
  /** Where notes are written: in Ultimyr's own pane, or in Obsidian / the Fast Note Sync dashboard. */
  editor: "ultimyr" | "obsidian";
  /** How the notes pane shows when editing in Ultimyr. */
  pane: "split" | "full" | "off";
}
export type NotesOffReason = "no_server" | "no_key";
export interface NotesConnection {
  enabled: boolean;
  reason: NotesOffReason | null;
  server: string | null;
  connected: boolean;
  vault: string | null;
  admin: boolean;
  prefs: NotesPrefs;
}
export interface NotesAdmin {
  fnsUrl: string | null;
  source: "env" | "admin" | null;
  keyPresent: boolean;
  canEdit: boolean;
}
export interface NotesPreview {
  root: string;
  total: number;
  truncated: boolean;
  notes: { path: string; title: string; kind: "index" | "step" }[];
}
export type MirrorState = "off" | "synced" | "pending" | "conflict" | "unreachable";
export interface ArchiveNotes {
  /** Obsidian can be connected on this server. */
  mirrorAvailable: boolean;
  /** This person's Obsidian vault is connected. */
  connected: boolean;
  prefs: NotesPrefs;
  /** Steps that have a note with text in it. */
  steps: Record<string, { path: string | null; obsidianUrl: string | null }>;
}
export interface StepNote {
  exists: boolean;
  content: string;
  hash: string;
  mirror: MirrorState;
  /** The vault's text, when it and this copy both changed. */
  remote?: string;
  obsidianUrl: string | null;
}
export interface SyncResult {
  total: number;
  synced: number;
  pulled: number;
  conflicts: number;
  failed: number;
}
export interface ScaffoldResult {
  total: number;
  created: number;
  existing: number;
  failed: string[];
  root: string;
  indexUrl: string;
}

/** Plain words for the safe error codes the notes service returns. */
export function notesMessage(code: string): string {
  const m: Record<string, string> = {
    notes_disabled: "Notes are not set up on this server yet. An administrator needs to add the Fast Note Sync address (Admin panel, Notes).",
    server_unreachable: "Nothing answered at that address from the Ultimyr server. If Fast Note Sync runs in Docker, use its container address (for example http://fns:9000), not localhost.",
    invalid_address: "That is not a usable address. Use something like http://fns:9000 or https://notes.example.com, with no password or query.",
    set_by_environment: "The address is set in the server's environment (FNS_URL), so it cannot be changed here.",
    notes_not_migrated: "The notes tables are missing from the database. An administrator should run: docker compose up -d --build",
    internal_error: "The notes service hit an unexpected error. An administrator can see why with: docker compose logs --tail 40 notes",
    unknown_error: "The notes service did not answer properly. An administrator can check it with: docker compose logs --tail 40 notes",
    forbidden: "Only an administrator can change that.",
    not_connected: "Connect Fast Note Sync in Settings first.",
    connection_unreadable: "Your saved connection can no longer be read. Disconnect and connect again in Settings.",
    fns_unreachable: "Cannot reach your Fast Note Sync server right now.",
    fns_token_rejected: "Fast Note Sync rejected your token. Paste a fresh one in Settings.",
    vault_not_found: "That vault name was not found on your server.",
    conflict: "This note changed somewhere else (for example in Obsidian). Reload it before saving.",
    no_note: "There is no note here yet.",
    archive_required: "Open the note from its roadmap step.",
    too_many_notes: "This roadmap has too many steps to create notes in one go.",
  };
  return m[code] ?? code.replaceAll("_", " ");
}

/** Folders Ultimyr should never be pointed at by accident: Obsidian's own settings folder. */
export const isRiskyFolder = (f: string) => f.split("/")[0]?.startsWith(".") ?? false;
