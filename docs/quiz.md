# Quizzes, questions and scoring

The quiz service owns the questions inside a quiz, the settings for taking it, scoring profiles, and every attempt. The quiz itself (its title, sharing and trash) is an item in the [content service](content.md), which also decides who may attempt or edit it. In the UI the themed name for a quiz is a Trial; the API always says quiz.

## Question types
| Type | Learner does | Answer key |
|---|---|---|
| `mcq` | Picks one option | One correct option id |
| `multi` | Ticks every option that applies | The correct option ids |
| `fib` | Types text into one or more blanks | Per blank: accepted answers, optional numeric value with tolerance, optional pattern |
| `dnd` | Places each item in a target (drop-down lists, so it works with a keyboard and screen reader) | Item id to target id |
| `pbq` | Fills in a scenario form (text, number, choice, checkbox) | A list of checks on the final state, each with a weight |

Fill-in answers ignore case, extra spaces and Unicode form unless the blank is marked case sensitive. Patterns are limited to 100 characters and patterns that can run away (nested repeats, back-references) are refused. Scenario forms are described by `payload.scenario.fields` (`path`, `label`, `kind`, `options`); checks use `path` plus an operator (`eq`, `neq`, `in`, `contains`, `gte`, `lte`, `matches`).

Every question has a **weight** (whole marks, 1 to 100), an optional **domain** (for the per-domain breakdown), an optional difficulty, an **explanation**, and a flag for **unscored trial** questions. Questions written by AI or MCP are saved as drafts and only enter attempts once an editor publishes them.

## Quiz settings
| Setting | Meaning |
|---|---|
| Mode | `practice` (instant feedback, no clock), `timed` or `exam_sim` (no feedback until the end, server clock) |
| Time limit | Required for timed and exam modes. 1 to 480 minutes. |
| Questions per attempt | Draw this many from the published pool, or all of them |
| Shuffle | Question order and answer options, fixed per attempt by a random seed |
| Scoring profile | How answers become a score and a pass or fail |
| Grace | Seconds after the deadline that a late save is still accepted (default 10) |

Learners can always run a practice attempt of any quiz, even a timed one.

## Attempts
1. **Start.** The server picks the questions, shuffles them, and **snapshots** both each question (with its key) and the scoring profile into the attempt. Editing or deleting a question, or replacing a profile, never changes an attempt that already started.
2. **Answer.** Each answer is saved as you go. In practice mode "Check answer" grades that one question, shows the explanation, and locks it.
3. **Submit** (or run out of time). The server grades once. Submitting again returns the stored result.
4. **Review.** Every question with your answer, the right answer, the explanation and the points.

The **clock belongs to the server.** The deadline is fixed at the start, the browser's timer is only a display, and the page's clock is corrected by the server's time. A save after the deadline plus grace is refused, and the attempt is graded as it stood at the deadline. Closing the tab does not pause anything. Learners never receive answer keys or explanations until a question is checked or the attempt is closed.

One attempt per quiz is open at a time per person; starting again resumes it unless you choose "start over".

## Scoring profiles
A profile is a small JSON document. Profiles are **immutable**: saving under the same name creates the next version, and each attempt keeps its own copy. Built in:

| Profile | Fidelity | What it does |
|---|---|---|
| Simple percent (70% to pass) | Custom | Percent of marks, partial credit on fill-in and matching, pass at 70% |
| Strict percent (all-or-nothing, 80% to pass) | Custom | No partial credit anywhere, pass at 80% |
| Scaled 100 to 900 (pass at 700) | Community estimate | Linear map of raw percent to 100 to 900, pass at 700 |

**Fidelity is stated honestly.** Vendors rarely publish how raw answers become a scaled score, so only a profile built from a published formula says *Published formula*. Everything else says *Community estimate* or *Custom* and results show "not an official exam score".

Profile fields: `rounding` (`half_up`, `floor`, `half_even`), per-type partial credit (`multi`: `all_or_nothing`, `partial`, `penalty`; `fib`: `all_or_nothing`, `per_blank`; `dnd`: `all_or_nothing`, `per_item`; `pbq`: `all_or_nothing`, `weighted`), `negativeMarkingBp` (loss for a wrong single choice, in basis points of that question's marks), `floorAtZero`, `excludePretest`, an optional `scale` (piecewise-linear points from raw basis points to scaled), a `pass` rule (`percent` with `minBp`, or `scaled` with `min`) and `domainMinBp` (every domain must reach this raw percentage too).

### How the maths stays exact
The scoring library (`packages/scoring`) is a pure function: `grade(profile, questions, responses)` with no clock, randomness or I/O. A question is worth `weight x 1000` milli-points. Partial credit is a fraction of whole numbers rounded **once per question** using the profile's rule, so totals are exact integers and raw scores are whole basis points. No floating point enters a total. The same library can run in the browser for previews and on the server for the authoritative grade.

It is checked by hand-computed **golden vectors** (`packages/scoring/test/golden.json`, change one and you are changing what past attempts would have scored), unit tests for every question type and rule, and seeded property tests (scores stay in bounds, scaling never decreases, answering more correctly never lowers a score, answering everything correctly earns full marks). Coverage is held at 95% lines and 85% branches in CI.

### Try a profile before you use it
`POST /scoring-profiles/simulate` takes an unsaved profile, sample questions and sample answers and returns the full breakdown (per question and per domain), so you can see exactly why a score came out as it did.

## Limits
Question text 10,000 characters; 12 options; 20 blanks; 100 assertions per scenario; 200 questions per bulk request; a saved answer up to 50 KB; 500 questions per attempt.
