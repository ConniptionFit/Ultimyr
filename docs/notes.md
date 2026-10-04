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
Ultimyr talks to your vault through [Fast Note Sync](https://github.com/haierkeys/obsidian-fast-note-sync), a self-hosted server plus an Obsidian plugin that keeps the vault in sync across your devices. Ultimyr never touches your files directly: it uses the server's REST API.

**Set up (once)**
1. Run a Fast Note Sync server. To run one next to Ultimyr: `docker compose -f docker-compose.yml -f docker-compose.notes.yml up -d`, then put `FNS_URL=http://fns:9000` in `.env` and recreate the `notes` service. Already have one? Just set `FNS_URL` to its address.
2. Open the server's web page, create your account and a vault, install the **Fast Note Sync** plugin in Obsidian and paste its config.
3. In Ultimyr: **Settings > Notes**. Paste the vault name and the API token (Copy API Config on the server page).

**Use**
- On an archive's Roadmap tab press **Create notes**. Ultimyr writes `00 Index.md` and one note per step using the layout above. It never overwrites a note that exists, so it is safe to press again after adding steps (**Add notes for new steps**).
- The note icon on a step opens it **beside the roadmap**: edit or preview Markdown and press Save (or Ctrl/Cmd+S). **Open in Obsidian** jumps to the same note in the app.
- Ticking a step sets `status: done` in its note's properties, and un-ticking sets `status: todo`. Nothing else in the note is changed by a tick.

**Good to know**
- Notes are matched to steps by the `ultimyr_step` property and a saved path. Renaming a *step* in Ultimyr does not rename its file. If you move or rename a note file in Obsidian, the pane will show it as missing; press **Create notes** to make a fresh one, or keep the old path.
- Saving sends the version the pane loaded. If the note changed meanwhile (for example you typed in Obsidian), the save is refused and you are asked to reload, so nothing is overwritten silently.
- The token is encrypted with the server's master key (the same key as the AI vault) and is never shown again. Without that key, or without `FNS_URL`, notes stay off and everything else works.
- The server address is set by the operator only, never by a person, so Ultimyr cannot be pointed at other machines.
- Flashcard lines (`Question :: Answer`) are not yet turned into decks automatically.
