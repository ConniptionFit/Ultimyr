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

## Sync with Obsidian
Ultimyr talks to your vault through [Fast Note Sync](https://github.com/haierkeys/obsidian-fast-note-sync) (FNS), a self-hosted server plus an Obsidian plugin that keeps the vault in sync across your devices. Ultimyr never touches your files directly: it uses the server's REST API.

**Set up (once, by an administrator)**
1. Run a Fast Note Sync server. To run one next to Ultimyr: `docker compose -f docker-compose.yml -f docker-compose.notes.yml up -d`. Already have one? Use its address.
2. Open **Admin panel > Notes (Obsidian)**, paste the server address (for example `http://fns:9000`) and press **Check and save**. Ultimyr checks that the server answers before it saves. Alternatively set `FNS_URL` in `.env` and recreate the `notes` service; the environment value wins and the page shows it read-only.
3. Notes also need the vault key (`./scripts/init-secrets.sh` creates it). The Settings page says exactly which of the two is missing.

**Connect (each person)**
1. On the FNS server page create your account and a vault, and install the **Fast Note Sync** plugin in Obsidian.
2. In Ultimyr open **Settings > Notes**. Paste your API token (Copy API Config on the server page) and press **Check token**. Your vaults are listed; pick one and press **Connect**.
3. Choose a **folder** in the vault (default `Ultimyr`; existing folders are suggested, up to three levels deep).

**Where the notes go**
`<folder>/<archive>/00 Index.md`, then one folder per stage and nested folders for nested steps, so the tree matches the roadmap in Ultimyr. On a roadmap, **Set up notes** shows the exact tree first (nothing is written yet), then **Create N notes** writes it. It never overwrites a note that exists, so it is safe to use again after adding steps (**Add notes for new steps**).

**Your settings (Settings > Notes)**
- **Where you edit notes:** *In Ultimyr* or *In Obsidian*. In Obsidian, the note icon on a step opens it in the Obsidian app.
- **Notes pane** (when editing in Ultimyr): *Split screen with slider* (roadmap left, note right, drag the divider or use the arrow keys; double-click resets it), *Full screen* (the note fills the page, with charms to go back to the roadmap, to the main menu, and to the previous or next step with a note; Escape also leaves), or *Off* (the icon opens Obsidian instead). Split stacks on small screens.
- The choices are saved with your account. The slider position is remembered in this browser.

**Use**
- Edit or preview Markdown and press Save (or Ctrl/Cmd+S). **Open in Obsidian** jumps to the same note in the app.
- Ticking a step sets `status: done` in its note's properties, and un-ticking sets `status: todo`. Nothing else in the note is changed by a tick.

**Flashcards and Claude**
- **Make a deck** (in the note pane) turns the `Question :: Answer` lines under `## Flashcards` into a new deck in the archive. It reads the saved note, so save first. Lines without both sides and duplicates are skipped, and pressing it again makes another deck.
- Connect Claude to Ultimyr's MCP and grant `notes:use` (it is offered on the consent page; untick it to keep your notes private). Claude can then read a step's note (`get_step_note`), add text at the end of it (`append_step_note`, never editing what you wrote) and read its flashcards (`get_step_flashcards`) to build a deck. Steps need a note first: press **Set up notes**.

**Good to know**
- Notes are matched to steps by the `ultimyr_step` property and a saved path. Renaming a *step* in Ultimyr does not rename its file. If you move or rename a note file in Obsidian, the pane will show it as missing; use **Add notes for new steps** to make a fresh one, or keep the old path.
- Saving sends the version the pane loaded. If the note changed meanwhile (for example you typed in Obsidian), the save is refused and you are asked to reload, so nothing is overwritten silently.
- The token is encrypted with the server's master key (the same key as the AI vault) and is never shown again.
- The server address is set only by platform administrators (or the environment), never by a person, so Ultimyr cannot be pointed at other machines. Credentials, query strings and redirects are refused.

**Troubleshooting**
- *"Notes are not set up on this server"*: Settings names the missing piece (server address or vault key). Admins set the address in Admin panel > Notes (Obsidian).
- *"internal error" or "notes are not ready"*: the notes database tables are missing. The service now migrates itself at start (`NOTES_AUTO_MIGRATE`, on by default); run `docker compose up -d --build`, then `docker compose logs --tail 40 notes` if it persists.
- *"server unreachable"*: the address must be reachable from the `notes` container (use `http://fns:9000` with the bundled file, not `localhost`).
