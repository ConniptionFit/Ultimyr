# Daily review, progress and goals

Three things help you study over weeks rather than in one sitting: a **daily review** of flashcards scheduled by a spaced repetition algorithm (themed name: Refresher), a **progress** page built from your quiz attempts and reviews, and a **goal** with a readiness estimate. All of it is private to you. Nobody else, not even the owner of a deck you study, can see your schedule or scores.

## Daily review (spaced repetition)
Open **Daily review** (`/study`), optionally narrowed to one course or deck. You see cards that are **due** (oldest first), then **new** cards up to your daily allowance. Press space (or tap) to show the answer, then say how it went:

| Button | Key | Meaning |
|---|---|---|
| Again | 1 | You did not remember it. It returns in a minute, and in this session. |
| Hard | 2 | You remembered with real effort. |
| Good | 3 | You remembered. |
| Easy | 4 | No effort at all. |

The page asks "How well did you remember?" and each button carries a one-line meaning (worded to match your themed or plain names setting). Each button shows when the card will come back ("1 min", "10 min", "3 days"). In **Your settings > Display** you can switch on **Flashcard flip**, a short, gentle tilt when an answer appears. It is off by default and never plays with Calm mode or reduced motion.

The schedule comes from **FSRS-5**, the open Free Spaced Repetition Scheduler. It tracks, per card, how stable the memory is and how difficult the card is for you, and schedules the next review for when your chance of remembering has dropped to your **desired retention** (default 90%).

You can change two settings (`GET` and `PUT /study/settings`): **desired retention** (70% to 99%; higher means more reviews and fewer forgotten cards) and **new cards per day** (0 to 500, default 20). Only published decks you can read are offered, and your schedule lives in the content service next to the cards, so a card you can no longer read simply stops appearing. Deleting a card deletes its schedule.

The scheduler is a pure function (`packages/fsrs`): the same history always produces the same schedule, with no random fuzz. It is covered by tests for the formulas (for example, the recall probability is exactly 90% when the time since review equals the stability), for how intervals grow, shrink after a lapse, and respond to early or late reviews, and by randomised property tests (difficulty stays between 1 and 10, stability stays positive, results are repeatable).

## Progress
`GET /analytics?archive=&days=` summarises your closed attempts (practice, timed and exam) over the last 7 to 365 days:

- **Summary:** attempts, accuracy (marks earned over marks available), minutes spent answering, and your **streak** (consecutive days with an attempt, counted through today or yesterday so a day is not lost before you study).
- **By day:** attempts, accuracy and minutes for each day.
- **By domain:** accuracy and how many questions that rests on. The three lowest domains with at least 3 questions are suggested as where to start.
- **Daily review:** cards learning, in review and due now, how many you reviewed today, the share you recalled over the last 30 days, and a forecast of cards due in each of the next 7 days (`GET /study/stats`).

Everything is computed from your attempts and reviews when you ask, so there is no background job to run and nothing to go stale.

## Goals and readiness
Set one **goal** per course: a target score and, optionally, an exam date (`PUT /goals/:archiveId`). The **readiness** figure is a weighted average of your latest 10 attempts, with the newest counting most (weights 1, 2, 3 and so on from oldest to newest). It needs at least 3 attempts. It tells you how you are doing against your own target and shows the gap and days left. It is an estimate of your practice results, **not a prediction of the real exam**, and the page says so.

## Exam simulation
Courses can include timed quizzes with a server-owned clock (see [quiz.md](quiz.md)). While an attempt is open the page listens to `GET /attempts/:id/events`, a server-sent event stream that sends the server's time and the time left every 10 seconds and a `closed` event the moment the attempt ends, so the display corrects itself and closes on time even if your device clock is wrong. Before submitting you get a review panel listing unanswered and flagged questions, each a link back to that question. Without the stream the page falls back to the clock it already has, and the server still enforces the deadline.

## Transcript
On Progress, **Print** (or save as PDF) gives a clean transcript of the current view: your name, course, range and date, then attempts, accuracy, minutes, streak, readiness, domains and review stats. Menus and forms are left out.

## Today strip
The Reading Room shows one line under the alerts: cards due now (links to the daily review) and your streak. It is hidden when you have neither.
