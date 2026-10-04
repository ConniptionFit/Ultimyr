# Content: archives, guides, decks and sharing

The content service owns everything a person studies. All routes are under `/api/v1` (see [api.md](api.md)). In the UI the themed names are Archive, Codex and Folio, which you can switch to plain names in Your settings. The API always uses the plain names.

## Model
| Thing | What it is |
|---|---|
| **Archive** (course) | A certification or subject. Has an icon, vendor, overview, quick stats (passing score, duration, questions, cost, difficulty), validity period and purchase links. |
| **Item** | Lives in an archive. Kinds: **guide** (Markdown), **deck** (flashcards) and **quiz** (a shell here, the questions live in the quiz service). |
| **Version** | Every change to a guide or deck makes a new, numbered version labelled with its source (`human`, `ai`, `mcp`, `import`, `restore`). Restoring copies an old version forward, so history is never rewritten. |
| **Section** | A guide is split at `#`, `##` and `###` headings. Sections get stable anchors (`#ports`) for deep links and search. Headings inside code fences are ignored. |
| **Card** | A deck entry: front, back, optional hint and tags. Up to 5,000 per deck. |

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

People are found by **exact email** (never listed), groups by name. Group memberships are fetched from the auth service and cached for 30 seconds, so a membership change can take up to that long to apply. If auth is unreachable, group grants pause but ownership and direct grants keep working.

## Search
`GET /api/v1/search?q=` searches archives, items, guide sections and cards with Postgres full text search (English stemming, ranked, highlighted snippets). It only searches material you can already read. Section results carry an anchor so the UI jumps to the right heading.

## Import and export
| Format | Export | Import |
|---|---|---|
| Archive JSON (`ultimyr-archive`) | Whole archive with guides and decks | Creates a new archive you own |
| Markdown | A guide, or a deck as Q and A | Becomes a guide (title from the first `#`) |
| Anki CSV | A deck as `front,back,tags` | Becomes a deck (comma or tab separated, quoted fields) |

Import and export never include other people's data. There is no lock-in: export an archive any time.

## Icons
Pick a Lucide icon by name, or upload a **PNG with transparency** (16 to 1024 px, up to 512 KB). Uploads are re-written server side keeping only image chunks, so EXIF, text and color profile metadata are stripped. Icons are served by unguessable id with `nosniff` and a locked-down CSP, because `<img>` tags cannot send tokens.

## Deleting
Deleting archives and items is a soft delete. They appear in `GET /api/v1/trash` and can be restored for 30 days, then a background job removes them for good.

## Limits
Markdown 500,000 characters, 5,000 cards per deck, 200 items per import, 500 grants per object, 20 tags per archive.
