# Exam prep tools

Four tools that help you get to the exam date and stay certified. All are under the **Exam prep** menu.

**Names:** with themed names on (Your settings), the menu and pages say Preparations, Sigils (credentials), Whetstone (drills), Atlas (coverage) and The Eve (countdown). Plain names are the default. APIs, MCP and exports always use the plain names.

## Credential tracker
**Where:** Exam prep > Credentials.

- One record per credential: status (planned, scheduled, earned, retired), exam date, voucher code and expiry, earned and expiry dates, renewal alert window, CEU hours needed.
- **CEU log:** add each activity with units and date. The total counts the current renewal cycle.
- **Alerts** show on the Reading Room and the Credentials page: exam today or soon, exam date passed, voucher expiring or expired, renewal due, expired, CEU hours short.
- Link a credential to an archive to jump to its drills and countdown.
- **Private:** only you see your credentials. Voucher codes are stored as plain text. MCP never returns them.

## Weak-area drills
**Where:** Exam prep > Drills, or the button on the Progress page.

- Pick an archive, a size (3 to 50 questions) and a focus: **mixed**, **weak** (low accuracy areas) or **missed** (questions you got wrong).
- Selection favours your weakest areas but caps any one area at 60%, so you do not drill a single topic.
- Each question shows why it was picked. A drill is an attempt of kind `drill` and is excluded from the readiness estimate.

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

## API and MCP
See [api.md](api.md) and [mcp.md](mcp.md).
