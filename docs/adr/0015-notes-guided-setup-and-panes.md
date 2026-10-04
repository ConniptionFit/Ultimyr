# ADR 0015: Guided notes setup, per-person root folder and pane

**Status:** Accepted. Amends ADR 0013 on who sets the server address.

## Context
Setting `FNS_URL` in `.env` was the only way to turn notes on, and an empty value looked like a broken feature. People also want to choose where notes live and how they edit them.

## Decisions
- **The server address can be set in the app by a platform administrator** (stored in `notes.instance_settings`). It is probed before saving, http or https only, no credentials or query, redirects refused. `FNS_URL` still wins when set. Ordinary people still cannot choose a host, so the SSRF stance of ADR 0013 holds.
- **The off state names its cause** (`no_key` or `no_server`) so Settings can say what to do.
- **Connecting is a check, then a pick:** a token check lists the vaults before anything is saved.
- **Per-person preferences live on the server** (`notes.preferences`: root folder, editor, pane) so they follow the person across devices. The split ratio is a purely visual preference and stays in the browser.
- **Preview before write:** the folder tree is shown from the same planner the scaffold uses, so what is previewed is what is created.
- **The notes service migrates itself at start** (`NOTES_AUTO_MIGRATE` default on) and maps missing-table errors to `notes_not_migrated`, so a skipped migration is a clear message, not "internal error".
