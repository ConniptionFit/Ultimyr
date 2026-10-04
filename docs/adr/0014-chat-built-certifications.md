# ADR 0014: Chat-built certifications

**Status:** Accepted

## Context
The MCP tools can already create every kind of material, but building a certification needs about eight tools in the right order, and a long build outgrows one chat. People want to describe a certification once and get a full archive.

## Decisions
- **The work list lives on the server, as a pure function.** `buildQueue` (in `@ultimyr/coverage`) turns the objective tree and counts into the next tasks. Any chat, on any assistant, can resume because the state is in Ultimyr, not in the conversation.
- **Small batches.** The queue hands out a few tasks at a time, which keeps each round inside the write rate limit and the assistant's context.
- **Facts come from the person.** The prompts tell the assistant to ask for the vendor's objectives and to stop without them. Objective weights, scores and prices are never guessed.
- **Link as you create.** `create_guide` and `create_deck` take `objectiveIds`, so material counts toward coverage with no extra call. Flashcards are made one deck per objective so coverage counts stay honest.
- **Drafts only, own words.** Everything is source `mcp` and a draft. Prompts forbid copying exam questions or vendor text.
- **The platform does not run the loop.** A server-side builder would need a stored AI key and long-running jobs. Prompts work with any MCP assistant and keep keys out of Ultimyr.

## Consequences
Quality depends on the assistant and the objectives supplied, so the review step matters. A later server-side builder could reuse the same queue.
