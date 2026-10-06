# ADR 0017: Notes live in Ultimyr, Obsidian is an optional two-way mirror

**Status:** Accepted. Supersedes the "Obsidian is the source of truth" decision of ADR 0013 and the editor and pane settings of ADR 0016.

## Context
Notes depended on a Fast Note Sync server, the vault key and a setup step before a person could write anything, and the Settings page could only fail with an error when any of them was missing. People want notes where they study (under the lesson or video) whether or not they use Obsidian, and want Obsidian, when they have it, to be an extra way in and a backup, with Ultimyr unchanged.

## Decisions
- **The text is stored in Ultimyr** (`notes.step_text`, per person and step). Notes need no server address, key or vault, so they cannot be "not configured".
- **One interface.** The note is a section directly under a leaf item and its video. The split screen, full screen and editor settings are removed. Parents (stages, courses, folders) and checkpoints have no notes.
- **Obsidian is a mirror, both ways.** Each note remembers the hash it had and the vault's hash at the last sync. A change on one side only is carried across; a change on both is never merged or overwritten: the person picks. A failing vault never blocks saving.
- **The vault file is the Obsidian properties plus the body.** Ultimyr keeps and shows only the body, and keeps the vault's own properties when it writes back.
- **Existing vault notes are adopted** on first open, so notes made by the earlier design are not lost.
- **Notes belong to the step the client names** (`archive` in the request, remembered afterwards); access to the archive is checked through the content service as the caller.
