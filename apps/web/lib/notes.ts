export interface NotesConnection {
  enabled: boolean;
  server: string | null;
  connected: boolean;
  vault: string | null;
}
export interface ArchiveNotes {
  enabled: boolean;
  connected: boolean;
  scaffolded: boolean;
  steps: Record<string, { path: string; obsidianUrl: string | null }>;
}
export interface StepNote {
  path: string;
  exists: boolean;
  content: string;
  hash: string;
  obsidianUrl: string;
}
export interface ScaffoldResult {
  total: number;
  created: number;
  existing: number;
  failed: string[];
  indexUrl: string;
}

/** Plain words for the safe error codes the notes service returns. */
export function notesMessage(code: string): string {
  const m: Record<string, string> = {
    notes_disabled: "Notes are not set up on this server. An admin needs to set the Fast Note Sync address.",
    not_connected: "Connect Fast Note Sync in Settings first.",
    connection_unreadable: "Your saved connection can no longer be read. Disconnect and connect again in Settings.",
    fns_unreachable: "Cannot reach your Fast Note Sync server right now.",
    fns_token_rejected: "Fast Note Sync rejected your token. Paste a fresh one in Settings.",
    vault_not_found: "That vault name was not found on your server.",
    conflict: "This note changed somewhere else (for example in Obsidian). Reload it before saving.",
    no_note: "This step has no note yet. Create the notes first.",
    too_many_notes: "This roadmap has too many steps to create notes in one go.",
  };
  return m[code] ?? code.replaceAll("_", " ");
}
