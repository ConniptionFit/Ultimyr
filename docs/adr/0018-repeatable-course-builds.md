# ADR 0018: Repeatable course builds for chats without credits

**Status:** Accepted

## Context
The bundle format (ADR 0015) already gives a strict, versioned way for any chat to write a certification. Runs still differed in guide shape, question quality and how much was covered, and there was no way to tell what a run had missed.

## Decisions
- **One source for the method.** Passes and content standards live in `@ultimyr/bundle` (`standards.ts`). The pasted prompt, the gap prompt and the downloadable Claude Skill are all generated from it.
- **Fixed passes.** Objectives and roadmap first, then one domain per reply, then gap fill. Small replies survive chat length limits and resume cleanly.
- **Check, do not trust.** `checkBundles` compares a parsed paste with the depth targets per objective (guide, cards, questions) and flags unknown or missing objective codes. The importer still accepts incomplete text, since drafts are cheap, but it tells you what to ask for next.
- **The skill is a generated file.** A store-only zip made in the browser, so there is nothing to host and no new service.
- **No new format version.** The bundle stays `v1`; the standards only constrain what the chat writes inside it.

## Consequences
Depth targets are duplicated from `@ultimyr/coverage` (the bundle package stays dependency free); a web test keeps them equal. Gap checking looks only at the text in the box, not at what is already saved in an archive; the Coverage tab covers that.
