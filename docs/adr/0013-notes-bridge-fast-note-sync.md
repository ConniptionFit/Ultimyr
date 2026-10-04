# ADR 0013: Notes through Fast Note Sync

**Status:** Accepted

## Context
Study notes belong in a tool people already use. Obsidian with Fast Note Sync (a self-hosted server, an Obsidian plugin and a REST API) gives sync across devices, history and an editor. People also want to write a note next to the step they are studying.

## Decisions
- **Obsidian stays the source of truth for notes; Ultimyr stays the source of truth for the path.** We do not store note text. The web pane reads and writes through the Fast Note Sync API.
- **A separate `notes` service**, not part of content. It holds secrets and talks to a server we do not control, so it is kept away from the content database and its failures cannot take the roadmap down. The web app treats it as optional.
- **Operator-set server address.** `FNS_URL` is configuration, never user input, so the service cannot be used to reach other hosts (no server side request forgery). Redirects are refused.
- **Per-person token, sealed with the master key.** AES-256-GCM, bound to the person with AAD, key versions for rotation, same `ULTIMYR_VAULT_KEK` as the AI vault. It is write-only: no route returns it. This is a smaller scheme than the AI vault (no per-person data key) because there is one short secret per person; moving both onto one shared package is a possible later cleanup.
- **Scaffolds never overwrite.** Creation uses create-only; a failed create is confirmed with a read before it counts as "already there". After creation Ultimyr only patches the `status` property.
- **Saves carry the loaded hash.** A change made in Obsidian meanwhile becomes a conflict the person resolves, not a silent overwrite.
- **Notes are matched to steps by id.** The path chosen at scaffold time is stored per person and step, and the note carries `ultimyr_step`. Renaming a step never breaks the link; moving the file in Obsidian does, and the pane says so.
- **Tick sync is best effort.** A tick never fails because notes are down.

## Consequences
We depend on Fast Note Sync's REST behaviour (create-only and base hash semantics are used as documented in its API description, with failures treated conservatively). Flashcard lines are not yet converted to decks, and Claude cannot yet read or write step notes through the Ultimyr MCP server; the Fast Note Sync MCP endpoint can be connected to Claude alongside Ultimyr for that.
