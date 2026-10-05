# Build with any chat: the bundle format

For a chat that cannot connect to Ultimyr (Gemini on the web, ChatGPT, Claude without a connector). The chat writes a certification as plain text, you paste it into Ultimyr, and Ultimyr checks it and saves it as **drafts**. No API key is needed and nothing leaves your browser except the normal Ultimyr API calls.

## Steps
1. Open **Exam prep > Build with an AI assistant** and scroll to **No connector? Copy and paste instead**.
2. Type the certification, pick a depth, and copy the prompt into your chat.
3. Give the chat the vendor's official exam objectives when it asks. If you have none, it stops. It never guesses objectives, weights, scores or prices.
4. The chat sends chunks: first the header, objectives and roadmap, then one chunk per exam domain. Say "next" until it is done.
5. Paste each chunk into the box on the page (or upload a text file). The page lists any line it cannot read, with the line number.
6. Choose a new archive or an existing one, and press **Save as drafts**. Review and publish in the archive. The Coverage tab shows what is still missing.

Saving twice is safe: a guide or deck with the same title is not duplicated, and cards and questions already in a deck or quiz are skipped. If the chat was cut off mid-block, the page says which block and asks you to have it resend that block.

## The format
```
ultimyr-bundle v1
archive: Example Cert
vendor: Example Vendor
overview: One or two sentences about the certification.

=== objectives ===
## 1.0 Networking (60%)
- 1.1 Explain common ports
- 1.2 Compare TCP and UDP
## 2.0 Security (40%)
- 2.1 Describe the CIA triad
=== end ===

=== roadmap ===
## Week 1: Networking
- [[Ports and protocols]]
- Take the networking quiz (optional)
=== end ===

=== guide: Ports and protocols ===
objectives: 1.1, 1.2
summary: The ports and transport protocols worth knowing.

# Ports and protocols

- HTTPS uses port 443.
- TCP is connection oriented; UDP is not.
=== end ===

=== deck: Networking flashcards ===
objectives: 1.1
What port does HTTPS use? :: 443
Which transport protocol is connectionless? :: UDP
=== end ===

=== quiz: Networking quiz ===
Q mcq 1.1 d2
Which port does HTTPS use by default?
a) 21
b) 443 *
c) 25
Why: HTTPS runs over TLS on port 443.

Q multi 1.2
Which are true of TCP?
a) It is connection oriented *
b) It guarantees delivery *
c) It has no handshake
Why: TCP sets up a connection and retransmits lost data.

Q fib 1.1
HTTPS uses port ___.
Answer: 443
Why: 443 is the registered port.
=== end ===
```

| Part | Rule |
|---|---|
| Header | `ultimyr-bundle v1`, then `archive:`, `vendor:`, `overview:` lines. Needed only to create a new archive |
| Blocks | Open with `=== kind: Title ===`, close with `=== end ===`. Kinds: `objectives`, `roadmap` (no title), `guide`, `deck`, `quiz` |
| objectives | `## 1.0 Domain (15%)` then `- 1.1 Objective`. Merged by code, so a later chunk can add more |
| roadmap | The roadmap outline from [content.md](content.md#roadmaps-and-external-resources). `[[Guide title]]` links to a guide, deck or quiz in the bundle. Saved last, so those titles exist |
| guide | Optional `objectives: 1.1, 1.2` and `summary:` lines, a blank line, then Markdown |
| deck | Optional `objectives:` line, then one card per line: `Question :: Answer` |
| quiz | Questions start with `Q mcq`, `Q multi` or `Q fib`, an optional objective code and difficulty `d1` to `d5`. Options are `a) text`, correct ones end with ` *`. Fill-in uses `___` per blank and one `Answer: one \| another` line per blank. `Why:` is the explanation |

Limits: 3,000,000 characters in all, 500,000 per guide, 500 cards per deck block, 200 questions per quiz block (more can follow in another block with the same title). Matching and lab questions are not part of the format. Anything the importer cannot read exactly is an error, never a guess.

Everything is saved with source `ai`, so it is a draft marked for review, like AI-generated material.
