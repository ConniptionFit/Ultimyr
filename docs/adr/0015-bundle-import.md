# ADR 0015: Text bundle import for chats without a connector

**Status:** Accepted

## Context
The MCP route (ADR 0014) needs an assistant that can connect to a self-hosted server. Gemini on the web and some other chats cannot. People still want to build a certification without an API key.

## Decisions
- **A strict text format the chat writes and the person pastes.** Blocks open with `=== kind: Title ===` and close with `=== end ===`, so a reply cut off mid-block is detected, not half imported.
- **Parse and save in the browser.** A pure parser (`@ultimyr/bundle`) checks the text, then the page saves through the existing public API as the signed-in person. No new endpoint, no new service, no new permissions.
- **Errors, never guesses.** Every unreadable line is reported with its line number. Nothing is saved until the text is clean.
- **Chunks merge by title.** A guide or deck with an existing title is not duplicated, cards and questions already present are skipped, so pasting twice is harmless. The roadmap is saved last so its `[[Guide title]]` links resolve.
- **Drafts only.** Content is saved with source `ai`, which means draft and flagged for review.
- **Fewer question types.** Multiple choice, select all and fill in. Matching and lab questions are too easy to get wrong in text.

## Consequences
The format is a second way to write the same material, so the example in the package is parsed by a test and shown to the chat, which keeps prompt and parser from drifting. A very large certification needs several chunks and several pastes.
