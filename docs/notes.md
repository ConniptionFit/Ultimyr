# Notes: the Ultimyr note standard

Ultimyr keeps your **path** (roadmaps, steps, progress). Your **notes** are plain Markdown files in an Obsidian vault. This page defines one layout and one format so that people, Obsidian, Claude and Ultimyr all know where things go. It is version 1 of the standard (`ultimyr: 1` in every note).

How the notes reach the web app (the side-by-side pane and the Obsidian sync) is described in the plan at `docs/architecture-plan.md` and, once built, in this file's sync section.

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
