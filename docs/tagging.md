# Tags and icons

Every course, section and piece of material can carry **tags** that say what it covers and what kind of material it is. Ultimyr uses them to read weak and strong areas and to pick icons. The same tags are available over the API and MCP, so an assistant can tag material as it builds a course. There is not much to see in the app on purpose: the stage icon and tag chips on a roadmap, and an icon picker on the archive edit form.

## What a tag looks like

A tag is `namespace:value` in lower case, for example `topic:ai` or `content-type:video`. Typing a bare word works: `ai`, `LLM` and `Artificial intelligence` all become `topic:ai`; `video` becomes `content-type:video`. Other namespaces (for example `vendor:acme`) are accepted and stored, but only the three below affect icons.

| Namespace | Meaning | Examples |
|---|---|---|
| `content-type` | The kind of material | `video`, `reading`, `audio`, `lab`, `quiz`, `flashcards`, `course`, `practice-exam`, `live`, `checkpoint` |
| `topic` | What it covers | `ai`, `agents`, `prompt-engineering`, `networking`, `security`, `cloud`, `databases`, `hardware`, `math`, `healthcare`, `finance` and about 30 more |
| `level` | How advanced it is | `beginner`, `intermediate`, `advanced` |

Get the full list with `GET /tags/vocabulary` or the MCP tool `get_tag_vocabulary`.

**A video with a written summary** is tagged both: the link is a video (set automatically from its kind) and you add `content-type:reading` to the saved link. A step that points at it then carries both.

## Where tags go

Archives, roadmap stages, roadmap steps, saved links (resources), guides, decks and quizzes, and exam objectives. A step also picks up the content type of what it points at (a video link, a flashcard deck). Free labels already on archives and links (their old `tags` field) are read as tags too and keep working.

Three kinds of tag are reported for each thing:

- **tags**: set by a person or an assistant.
- **derived**: implied by what it is (a video link, a deck). Not stored.
- **inferred**: read from its title, summary and the exam objectives linked to it (for example "large language models" gives `topic:ai`). Not stored. This is how untagged material still gets sensible icons and how objectives feed section tags.

## Icons

The whole Lucide library (1,866 icons at the version in `packages/tagging/data/catalog.json`, ISC licensed, notice in `data/LUCIDE-LICENSE`) is bundled in the app. Nothing is fetched from the internet. Each icon has:

- `tags`: what it depicts, in Lucide's own words.
- `suggestFor`: the vocabulary tags it suits, best first. This is the "when to suggest it" part. For example `bot` suits `topic:ai` and `topic:agents`.

**Ranking.** For a stage, step or archive, Ultimyr collects its tags with weights and ranks every icon:

- A curated pick for a tag scores most (the first icon in a tag's list, such as `bot` for AI, scores highest).
- A matching word in an icon's name or Lucide tags scores less.
- The more of the thing's tags an icon suits, the higher it ranks. Topic tags count fully, content types about half, and `level` does not affect icons.
- Tags set by hand count fully, implied content types a bit less, tags read from text less again, and each level up (step to stage to course) halves what it passes down.

**Automatic assignment.** If the best icon scores at least 5 (one confident curated match), it is assigned and marked `auto`. If nothing matches that well, nothing is assigned (stages and steps have no icon; a course keeps the book). It re-runs when tags, titles, the roadmap or the course change.

**Your choice always wins.** Picking an icon yourself marks it `user`, and automatic assignment never replaces it, however tags change. Choose "Choose for me" in the picker (or send `icon: null`) to hand it back.

Icons already chosen on existing courses stay yours when you upgrade.

## Known limits

- Archive export and import do not carry tags set through this system or icon choices on stages and steps yet; the course icon name and the old free `tags` field still travel. Tags are quick to re-apply from the vocabulary.
- Coverage and weak-area scoring still read exam objectives as before; tags on objectives and on material are available for them but do not change those scores yet.

## API

All under the content service; see [api.md](api.md#tags-and-icons-content-service).

## MCP

`get_tag_vocabulary`, `get_tags`, `set_tags`, `search_icons`, `suggest_icons`, `set_icons`. See [mcp.md](mcp.md). Tags and icons are metadata and apply at once; they are not drafts.

## Upgrading

`git pull && docker compose up -d --build`. Migration `0008_tagging` (content) adds the tag table and icon columns; it runs by itself on start and changes no existing rows except marking courses with a custom icon as yours. Behind Traefik the content router also forwards `/api/v1/tags` and `/api/v1/icons`; behind Nginx Proxy Manager route those paths to the content service.

## Updating the icon library

Bump the pinned `lucide-static` version in `packages/tagging/package.json`, run `pnpm install` then `pnpm --filter @ultimyr/tagging build:catalog`, and commit the regenerated `data/` files. The tests fail if a curated icon in the vocabulary no longer exists, so a rename is caught before release.

## Extending the vocabulary

Add a value to `packages/tagging/src/vocabulary.ts`: a label, synonyms (words that point at it) and a short list of curated icons, best first. No migration is needed.
