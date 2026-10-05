# Notes: the Ultimyr note standard

Ultimyr keeps your **path** (roadmaps, steps, progress). Your **notes** are plain Markdown files in an Obsidian vault. This page defines one layout and one format so that people, Obsidian, Claude and Ultimyr all know where things go. It is version 1 of the standard (`ultimyr: 1` in every note).

How the notes reach the web app (the side-by-side pane and the Obsidian sync) is described in [Sync with Obsidian](#sync-with-obsidian) below.

## Why this shape
- **One note per thing you study.** Each course, lesson, video or page on the path gets its own small note, so progress and notes line up one to one.
- **Fixed headings.** You always know where a summary, a question or a flashcard goes, and an AI writing into a note puts things in the same places you do.
- **Links over copies.** Short notes linked by `[[wikilinks]]` beat long notes. Obsidian's graph and backlinks then show how ideas connect.
- **Keyed by id, not title.** Renaming a note or a step never breaks the link between them.

## Folder layout
```
Ultimyr/
  <archive slug>/
    00 Index.md                       the hub for this archive
    01 <Stage title>/
      01 <Step title>.md              one note per step
      02 <Step title>.md
    Concepts/
      <Concept name>.md               one idea per note, linked from step notes
    Reviews/
      2026-10-04 Practice test 1.md   what you missed and why
```
- Numbers keep the file list in path order. Child steps (lessons inside a course) go in a folder named after the course: `01 Foundations/01 Prep hub/01 Lesson 1.md`, with the course's own note at `01 Foundations/01 Prep hub.md`.
- Names use plain words. Characters Obsidian dislikes (`# ^ [ ] | \ / : ?`) are removed, and names are cut at 80 characters.

## Frontmatter
Every note starts with the same properties (they show in Obsidian's Properties panel and can be searched and queried):
```yaml
---
ultimyr: 1                  # standard version
type: step                  # index | step | concept | review
archive: claude-architect   # archive slug
ultimyr_step: 0198a1b2-...  # the roadmap step this note belongs to (step notes only)
stage: "Week 1: Foundations"
source: https://...         # the link this note is about, if any
status: todo                # todo | reading | done
tags: [ultimyr, claude-architect]
---
```
`status` is the only property Ultimyr changes after the note exists: ticking the step sets `done`, and un-ticking sets it back to `todo`. Everything else, and the whole body, is yours.

## Body of a step note
Fixed headings, in this order. Delete any you do not need; do not rename them.
```markdown
## Summary
Three lines, in your own words.

## Key points
- 

## Examples
Worked examples, commands, small diagrams.

## Questions
- Things to look up or ask someone.

## Flashcards
What is the maximum context window? :: ...

## Related
- [[Concept name]]
- [[01 Another step]]
```
**Flashcards** are one per line as `Question :: Answer`. They stay readable in Obsidian and can later be turned into a flashcard deck.

## Other note types
| Type | Where | Purpose |
|---|---|---|
| `index` | `00 Index.md` | The archive's hub: goal, exam date, each stage as a `[[link]]`, and a short "where I am" line |
| `concept` | `Concepts/` | One idea in a few lines, with `## Definition`, `## Why it matters`, `## Example`, `## Related` |
| `review` | `Reviews/` | After a practice test: `## Result`, `## Missed and why`, `## Fix`, linking the step and concept notes to revisit |

## Rules of thumb
1. Write in your own words. A paragraph copied from a course teaches nothing.
2. If an idea comes up twice, make a concept note and link it.
3. After every practice test, write a review note and link what to revisit.
4. Keep step notes short. If one grows past a screen, split out concepts.

## Your notes
Notes are saved in Ultimyr and need no setup. Under any lesson, video or other item in a roadmap (not under a stage, a course folder or a checkpoint) press **Add a note**. The note opens directly beneath the item and its video player, saves a moment after you stop typing, and has Write and Preview tabs, a **Start from the note template** link and **Make a deck**. Only items with nothing inside them get a note; parents (a course, a folder) do not.

**Make a deck** turns the `Question :: Answer` lines under a `## Flashcards` heading into a new deck in the archive.

## Also keep them in Obsidian (optional)
Ultimyr can mirror every note to your Obsidian vault through [Fast Note Sync](https://github.com/haierkeys/obsidian-fast-note-sync) (FNS), a self-hosted server plus an Obsidian plugin. Once connected the notes are kept in step **both ways**, so Obsidian is another way to read and edit them and a backup. Ultimyr looks and behaves the same with or without it.

**Set up (once, by an administrator)**
1. Run a Fast Note Sync server. To run one next to Ultimyr: `docker compose -f docker-compose.yml -f docker-compose.notes.yml up -d`. Already have one? Use its address.
2. Open **Admin panel > Notes (Obsidian)**, paste the server address (for example `http://fns:9000`) and press **Check and save**. Alternatively set `FNS_URL` in `.env`; the environment value wins.
3. The vault key must exist (`./scripts/init-secrets.sh` creates it). Settings says exactly which of the two is missing.

**Connect (each person)**
1. On the FNS server page create your account and a vault, and install the **Fast Note Sync** plugin in Obsidian.
2. In Ultimyr open **Settings > Notes**. Paste your API token (Copy API Config on the server page), press **Check token**, pick your vault and press **Connect**.
3. Choose a **folder** in the vault (default `Ultimyr`; existing folders are suggested). Notes you already wrote are copied there as you open or save them, or all at once with **Sync all notes now**.

**Where the notes go in the vault**
`<folder>/<archive>/00 Index.md`, then one folder per stage and nested folders for nested items, so the tree matches the roadmap. Each note starts with Obsidian properties (`ultimyr_step`, `status` and so on) and the title; the part you write is what Ultimyr shows. A note that already exists in the vault (made by an older version, or in Obsidian) becomes your note in Ultimyr the first time you open that item.

**How the two copies stay in step**
- Changed only in Obsidian: Ultimyr takes the new text in next time you open the note.
- Changed only in Ultimyr: it is written to the vault when you save.
- Changed in both places since they last matched: nothing is overwritten. Ultimyr shows both versions and asks **Keep mine** or **Use the Obsidian version**.
- If the vault is offline when you save, the note is saved in Ultimyr and the line under it says it will sync later.
- Ticking an item sets `status: done` (or `todo`) in the vault copy's properties. Nothing else changes.

**Claude**
Connect Claude to Ultimyr's MCP and grant `notes:use` (offered on the consent page; untick it to keep your notes private). Claude can read an item's note (`get_step_note`), add text at the end of it (`append_step_note`, never editing what you wrote) and read its flashcards (`get_step_flashcards`) to build a deck. Pass the archive id the first time.

**Good to know**
- Notes are matched to items by id. Renaming an item in Ultimyr does not rename its file. If you move or rename a note file in Obsidian, Ultimyr writes a new file at the expected path.
- Saving sends the version the screen loaded. If the note changed elsewhere meanwhile (another tab), the save is refused and you are asked to reload, so nothing is overwritten silently.
- The token is encrypted with the server's master key (the same key as the AI vault) and is never shown again. Disconnecting never deletes notes, in Ultimyr or in the vault.
- The server address is set only by platform administrators (or the environment), never by a person, so Ultimyr cannot be pointed at other machines. Credentials, query strings and redirects are refused.
- The notes service creates and updates its own database tables at start (`NOTES_AUTO_MIGRATE`, on by default).

**Troubleshooting**
- *The Notes settings look old or show an error:* check the build you are running. `git log -1 --oneline` in the Ultimyr folder should match the latest commit on GitHub; if `git pull` was refused because of local edits, run `./scripts/update.sh` (it stashes them for you). An error message now ends with a short `ref`; search for it in `docker compose logs notes`. Then `docker compose logs --tail 40 notes` shows the cause of any error.
- *"Obsidian needs a Fast Note Sync server first":* an administrator sets the address in Admin panel > Notes (Obsidian).
- *"server unreachable":* the address must be reachable from the `notes` container (use `http://fns:9000` with the bundled file, not `localhost`).
