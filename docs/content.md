# Content: archives, guides, decks and sharing

The content service owns everything a person studies. All routes are under `/api/v1` (see [api.md](api.md)). In the UI the themed names are Archive, Tome (study guide) and Grimoire (flashcard deck), which you can switch to plain names in Your settings. The API always uses the plain names.

## Model
| Thing | What it is |
|---|---|
| **Archive** (course) | A certification or subject. Has an icon, vendor, overview, quick stats (passing score, duration, questions, cost, difficulty), validity period and purchase links. |
| **Item** | Lives in an archive. Kinds: **guide** (Markdown), **deck** (flashcards) and **quiz** (a shell here, the questions live in the quiz service). |
| **Version** | Every change to a guide or deck makes a new, numbered version labelled with its source (`human`, `ai`, `mcp`, `import`, `restore`). Restoring copies an old version forward, so history is never rewritten. |
| **Section** | A guide is split at `#`, `##` and `###` headings. Sections get stable anchors (`#ports`) for deep links and search. Headings inside code fences are ignored. |
| **Card** | A deck entry: front, back, optional hint and tags. Front and back are Markdown and can run over several lines (Ctrl or Cmd plus Enter saves in the editor). Up to 5,000 per deck. A deck page shows 100 cards at a time (Show more loads the next 100; the filter searches all of them). A deck prints as a plain list of fronts and backs (Print or save as PDF on the deck page). |

## Roadmaps and external resources
An archive can carry a **roadmap** (themed name: Labyrinth) and a library of **resources** (themed name: Secret Shop). Open them from the tabs on the archive page.

| Thing | What it is |
|---|---|
| **Resource** | A link to something outside Ultimyr: a video, playlist, article, course, docs page, practice site, book or podcast. Has a title, provider, estimated minutes and a short note on what you get from it. Only `https` links are accepted, with no username or password. The same link is stored once per archive (tracking parameters such as `utm_*` and `si` are dropped). |
| **Roadmap** | One ordered path per archive: **stages** (for example "Week 1: Foundations") made of **steps**. |
| **Step** | One of: a guide, deck or quiz from the same archive; a resource; or a **milestone** (a checkpoint with no link, such as "Take a practice exam"). Each step can be required or optional, carry a note and its own time estimate. A step can hold **steps of its own**, up to three levels: a course holds lessons, a lesson holds pages or videos. |
| **Progress** | Each person ticks steps off for themselves. Only the innermost steps (leaves) carry a tick. A parent shows how many of its steps are done and counts as done when everything it requires is done; ticking a parent ticks everything under it, and a parent that is optional makes everything inside it optional. A course's own minutes are used only when its lessons have none. Nobody sees anyone else's ticks. The roadmap shows percent of required steps done, minutes left, and the next step. The dashboard shows where you are on every roadmap you can read. |

Ultimyr **never opens the links you save on the server**. It does not fetch titles, thumbnails or videos, so a link cannot make the server call another host. Links open in a new tab. The provider name (YouTube, Anthropic, and so on) is worked out from the address.

### Watching videos in the app

### Following the roadmap (guided path)
An archive that has a roadmap opens on it. In **Guided** view (the default) the step you are on, the first required step not yet done, is marked **You are here** and opens in place: a video plays under the row, a guide is read inline, a deck is studied inline (**Study here**), a quiz starts from the step (**Take it here**) and returns you to the roadmap afterwards, and your note opens beneath. **Done, next step** ticks it and scrolls to the next one, which opens in turn. Other steps open with the same buttons whenever you like. **Compact** shows the plain checklist; the choice is stored in your browser (`ultimyr_path_view`). Articles and other sites still open in a new tab because they cannot be shown inside Ultimyr.

**More on the path**
- **Continue** (Reading Room) jumps straight to your current step.
- **Keys:** `J` next step, `K` previous step, `D` mark done and move on (not while typing).
- **Finished that?** After you open an article or other site from a step and come back to the tab, the step asks whether to tick it.
- **Ticks itself:** a video ticks its step when it ends (YouTube, Vimeo and direct video files report this; Loom and other embeds cannot), a deck when its queue is caught up, a quiz once you have passed it. Videos remember where you stopped (kept in this browser).
- **Today's session** (Off, 20, 45 or 90 minutes) marks the next required steps that fit with a **Today** badge. Steps with no minutes count as 10.
- **Stage bar** along the top jumps between stages and shows progress for each.
- **Deck steps** use the real spaced-repetition queue with the four ratings, so path study and the Study page feed the same schedule.
- **Streak and readiness** (your quiz days in a row, readiness estimate, weakest area with a Drill link) show above the steps; the streak is hidden in Calm mode.
- **Notes:** search your notes for the archive, and **My notes** on a stage shows all of that stage's notes in order.
- **Offline copies:** **Keep for offline reading** under a guide or deck saves a copy in this browser only (removed when you sign out). If the server cannot be reached the copy is shown. Course and item pages keep a copy of their empty page shell for the same reason; no account data is cached.
- **Copy from another course** (editors, in the roadmap toolbar) pulls another course's roadmap into this one as an unsaved draft. Links come across; guides, decks and quizzes become checkpoints with the same title because they belong to the other course. To share a path read-only, use Share on the course.

A link that is a video (kind `video` or `playlist`, or tagged `content-type:video`) gets a play button in place of its icon, on the Resources tab and on roadmap steps. Press it and a player drops down under the row; press it again, or **Close**, to fold it away. **Nothing loads from another site until you press play.**

| Link | Played as |
|---|---|
| YouTube watch, `youtu.be`, shorts, embed, playlist links | YouTube's privacy-enhanced player (`youtube-nocookie.com`). A `t=` start time and a playlist are kept. |
| Vimeo, including unlisted links with a hash | Vimeo's player with do-not-track on. |
| Loom shares | Loom's embed player. |
| A direct `.mp4`, `.m4v`, `.webm`, `.ogv` or `.mov` link | The browser's own video player. |
| Anything else | Stays a normal link that opens in a new tab. |

Only these known providers are embedded, never an address typed into the page, and the iframe is sandboxed. Every player has an **Open the original** link for videos the owner has set to not allow embedding. If you put Ultimyr behind a proxy that adds a `Content-Security-Policy`, allow `frame-src https://www.youtube-nocookie.com https://player.vimeo.com https://www.loom.com` and, for direct files, `media-src https:`. Ultimyr itself sets no page-wide policy that would block them.

### Example: Claude's training pages and YouTube videos
The prep hub for Claude Certified Architect Foundations (`https://anthropic-partners.skilljar.com/claude-certified-architect-foundations-certification#ccarf-prep`) is a good first resource: add it as a `course`, then place it in an early stage of the roadmap, followed by your guides and decks, optional YouTube videos, and a milestone for each practice test.

1. Open the archive, then **Resources**, then **Add a link**. Paste the address, give it a title and rough minutes.
2. Open **Roadmap**, then **Build roadmap**. Add a stage, then use **Add from this course** to pick your guides, decks, quizzes and saved links, or **New link** to add one on the spot.
3. Reorder with the arrows, mark extras as optional, add checkpoints, then **Save**. The same thing can be done through [MCP](mcp.md) (`add_resources`, `set_roadmap`).

### Pasting an outline
To load a whole certification at once, open **Roadmap**, then **Paste an outline**. The same text works through MCP (`import_outline`) and the API.

```
## Week 1: Foundations
Short description of the stage (optional).
- [Claude Certified Architect prep hub](https://anthropic-partners.skilljar.com/claude-certified-architect-foundations-certification) 90m
  - [Lesson 1: Overview](https://www.youtube.com/watch?v=abc) 12m
  - [Lesson 2: Prompts](https://www.youtube.com/watch?v=def) 20m -- watch twice
  - [[Foundations guide]]
- Take practice exam 1 (optional) -- aim for 70%
```
| Write | Means |
|---|---|
| `## Title` | A stage |
| `- item`, `1. item` | A step. Indent by two or more spaces to put it inside the step above (three levels at most; deeper lines move up a level and you are told) |
| `[Title](https://...)` | A link step. A link with steps under it is saved as a `course` |
| `[[Title]]` | One of this archive's guides, decks or quizzes, matched by title. No match becomes a checkpoint and you are told |
| `12m`, `1h30m`, `2 hours` | Minutes |
| `(optional)` | Not required |
| `-- text` or ` — text` | A note for the learner |
| Anything else | A checkpoint |

Links that are not `https` become checkpoints (with a warning). The import adds to the end of the roadmap and keeps everyone's progress; **Replace the roadmap** starts again and drops progress.

### Drafts and sharing
Roadmaps and resources follow the same draft rule as guides. Writes from MCP or AI are saved as drafts that only editors see, until a person presses **Publish** (on the roadmap, and on each draft link). Learners need at least `viewer` access to the archive to see the roadmap; people who were only lent one quiz do not see it. Steps pointing at a draft guide or link are hidden from learners until that target is published.

Editing a roadmap keeps people's ticks on every step whose id is kept. Removing a step, or deleting a resource, also removes its ticks. Limits: 30 stages, 60 steps per level, 1,000 steps and 1,500 resources per archive.

## Drafts
Material written by AI or through MCP lands as a **draft**: only editors can see it. Publishing it (a person clicking Publish, or `PATCH status=published`) marks it `reviewed`. Human and import writes publish immediately.

## Sharing
Access is the best of these, highest wins:
1. **Owner** of the archive.
2. **Visibility**: `org` or `public` give every signed-in user read access (single tenant, so "org" is everyone on this install). `private` and `shared` give none by themselves.
3. **Grants** on the archive, or on one item, to a user or a group. Groups come from SSO and SCIM.

| Relation | Can |
|---|---|
| `attempt` | Open quizzes only |
| `viewer` | Read published material |
| `editor` | Read drafts, edit, add and remove items and cards |
| `owner` | Everything, including sharing, visibility and deleting |

Grants can expire. An item-level grant opens just that item, and the archive card appears in the recipient's list. Admins get no special read access to private material. Token scopes cap everything: an API key with only `content:read` cannot write even for its owner. Unknown and forbidden objects both answer 404, so existence never leaks.

Administrators and **curriculum admins** can also manage group grants centrally from Admin panel > Group access. They see **view** (`viewer`) and **manage** (`editor`) levels. A curriculum admin has owner level access to every course (they can edit, share, change visibility, delete and restore), which is the one exception to "admins get no special read access" above. See [identity.md](identity.md#admin-panel).

People are found by **exact email** (never listed), groups by name. Group memberships are fetched from the auth service and cached for 30 seconds, so a membership change can take up to that long to apply. If auth is unreachable, group grants pause but ownership and direct grants keep working.

## Search
`GET /api/v1/search?q=` searches archives, items, guide sections, cards and saved resources with Postgres full text search (English stemming, ranked, highlighted snippets; the last word, once it has three letters, also matches as a prefix so results appear as you type). It only searches material you can already read. Section results carry an anchor so the UI jumps to the right heading.

## Import and export
| Format | Export | Import |
|---|---|---|
| Archive JSON (`ultimyr-archive`) | Whole archive with guides, decks, saved resources and the roadmap | Creates a new archive you own |
| Markdown | A guide, or a deck as Q and A | Becomes a guide (title from the first `#`) |
| Anki CSV | A deck as `front,back,tags` | Becomes a deck (comma or tab separated, quoted fields) |
| Ultimyr bundle (text) | None | A whole certification written by any chat: objectives, roadmap, guides, decks and quizzes, saved as drafts. See [bundle.md](bundle.md) |

In the archive file, roadmap steps point at items by position and at resources by link, so it carries no database ids; steps on quizzes become checkpoints with the quiz's title (quizzes are not part of the file), and progress is never exported. Import and export never include other people's data. There is no lock-in: export an archive any time.

## Icons
Pick any icon from the bundled Lucide library (about 1,900, searchable), let Ultimyr choose from the course's tags (see [tagging.md](tagging.md)), or upload a **PNG with transparency** (16 to 1024 px, up to 512 KB). Uploads are re-written server side keeping only image chunks, so EXIF, text and color profile metadata are stripped. Icons are served by unguessable id with `nosniff` and a locked-down CSP, because `<img>` tags cannot send tokens.

## Deleting
Deleting archives and items is a soft delete. They appear in `GET /api/v1/trash` and can be restored for 30 days, then a background job removes them for good.

## Limits
Markdown 500,000 characters, 5,000 cards per deck, 200 items per import, 500 grants per object, 20 tags per archive.

## Search filters
When results span several kinds, filter chips with counts appear above the list (All, courses, material, guide sections, flashcards, links). Filtering happens in the page, so it is instant.
