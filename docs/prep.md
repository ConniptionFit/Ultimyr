# Exam prep tools

Four tools that help you get to the exam date and stay certified. All are under the **Exam prep** menu.

**Names:** with themed names on (Your settings), the menu and pages say Strategy Time, Aegis (credentials), Dust of Appearance (drills), Observer Wards (coverage) and Roshan Timer (countdown). Plain names are the default. APIs, MCP and exports always use the plain names.

## Credential tracker
**Where:** Exam prep > Credentials.

- One record per credential: status (planned, scheduled, earned, retired), exam date, voucher code and expiry, earned and expiry dates, renewal alert window, CEU hours needed.
- **CEU log:** add each activity with units and date. The total counts the current renewal cycle.
- **Alerts** show on the dashboard and the Credentials page: exam today or soon, exam date passed, voucher expiring or expired, renewal due, expired, CEU hours short.
- **Add to calendar** downloads a `.ics` file with your exam (with a reminder the day before), voucher expiry (a week before) and renewal dates (your alert window before). It is built in your browser and leaves voucher codes out. Import it into Google, Apple or Outlook Calendar.
- Link a credential to an archive to jump to its drills and countdown.
- **Private:** only you see your credentials. Voucher codes are stored as plain text. MCP never returns them.

## Weak-area drills
**Where:** Exam prep > Drills, or the button on the Progress page.

- Pick an archive, a size (3 to 50 questions) and a focus: **mixed**, **weak** (low accuracy areas), **missed** (questions you got wrong), **new** (never answered), **bookmarked** (questions you bookmarked) or **diagnostic** (the same number from every topic, unseen first, so the result by topic shows where you stand across the whole exam; a good first drill on a new course).
- Tick one or more **topics** to build a custom practice set from just those domains (leave all empty for the whole course).
- In practice attempts and when reviewing a finished attempt, each question has **Bookmark this question** and a private **My note** (a mnemonic, why you missed it). Both follow you into later attempts and drills and are never shown to anyone else.
- Selection favours your weakest areas but caps any one area at 60%, so you do not drill a single topic.
- Each question shows why it was picked. A drill is an attempt of kind `drill` and is excluded from the readiness estimate.

## Mock exam
**Where:** Exam prep > Mock exam (themed: Ranked Match), or the practice exam task in your countdown plan.

- Pick a course, a number of questions (10 to 200) and minutes (10 to 480). The exam is drawn from **every quiz in the course**, on the server clock, with no feedback until you submit, like the real thing. Your extra time setting applies.
- **Domain weights.** If the course has exam objectives with domain weights (Coverage tab), the exam gives each domain its share of the questions (largest remainder, so the total is exact; a domain with too few questions hands its share to the others). Questions on no weighted domain share what is left. Without weights it draws evenly.
- Questions you have not answered before come first, so repeats are rare until the bank runs out. Unscored pretest and draft questions are never used.
- A mock exam is an attempt of kind `mock`. **It counts toward your readiness estimate** (drills do not) and appears in Progress. Results include confidence, domain scores and a review of every question.
- API: `POST /mock-exams` `{ archiveId, count, minutes, blueprint?: [{ objectiveIds, weightBp }], profileId?, extraTimePct?, restart? }`. Adds migration `0009_mock_exams` (quiz). Behind Traefik the quiz router also forwards `/api/v1/mock-exams`; behind Nginx Proxy Manager route that path to the quiz service.

## Coverage map
**Where:** the Coverage tab on an archive.

1. **Import objectives** from an outline:
   ```
   ## 1.0 Domain name (15%)
   - 1.1 Topic
   ```
2. **Link material:** on a guide or deck, choose the objectives it covers. On a question, pick its objective.
3. **Read the map:** per objective you see cards, questions and your accuracy. Gaps are flagged when there are fewer than 5 cards, fewer than 3 questions, or accuracy below 70% after 3 answers.

Merge by code or title keeps links when you re-import.

## Exam-day countdown
**Where:** Exam prep > Exam day (from a credential, or pick an archive and date).

- Phases: build, consolidate, sharpen, taper, exam day. Daily tasks fit your minutes per day.
- Advice and the checklist change with the exam mode (test center or online). Checklist ticks are saved in your browser.

## Build with an AI assistant
**Where:** Exam prep > Build with an AI assistant, and the Coverage tab of an archive. It gives you a prompt that has Claude (or another MCP assistant) build objectives, a roadmap, guides, flashcards and questions as drafts, and tracks progress. See [mcp.md](mcp.md#build-a-whole-certification-from-one-prompt).

No connector (Gemini, ChatGPT, Claude without one)? The same page has a copy and paste route: the chat writes a text bundle and Ultimyr saves it as drafts. See [bundle.md](bundle.md).

## API and MCP
See [api.md](api.md) and [mcp.md](mcp.md).

The voucher code and credential ID on a credential each have a copy button.

On the Credentials page, Working toward is ordered by exam date and Earned by expiry date, soonest first.

The countdown plan has a **Print** button for a paper or PDF copy.
