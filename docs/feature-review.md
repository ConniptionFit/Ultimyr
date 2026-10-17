# Feature review against other certification tools

Ultimyr is reviewed against how people actually prepare for certifications elsewhere, so a learner can do the whole job here: learn, practise, drill weak spots, rehearse the exam and track the credential. This page records what was compared, what was added and what is deliberately left out. It is updated at the end of each batch.

**Compared with:** Anki (flashcards), Tutorials Dojo, Boson ExSim, MeasureUp and Udemy practice tests (practice exams), UWorld and AMBOSS style question banks (analytics), Pluralsight and A Cloud Guru (assessments, labs, paths), Pearson VUE exam interfaces (exam-day tools), and vendor portals (Microsoft Learn, AWS Skill Builder, Skilljar) for roadmaps. Sources are the vendors' own pages and tutorials where available; marketing claims were not treated as facts, and gaps in what could be confirmed are noted.

## What a certification learner needs, and where it lives

| Need | Where | Status |
|---|---|---|
| Structured learning path | Roadmap (nested steps, videos, guides, decks, quizzes) | Built |
| Study guides, videos, links | Guides, Resources, in-app video player | Built |
| Flashcards with spaced repetition | FSRS daily review, undo, deck CSV (Anki, Quizlet text) import and export | Built |
| Cloze cards, suspend, bury, leeches | Daily review | Added in batch 1 |
| Glossary and acronyms | Glossary tab | Added in batch 1 |
| Practice questions in every exam format | Single, multiple, fill-in, drag and drop, scenario | Built |
| Practice, timed and exam modes with a server clock | Quiz settings, attempts | Built |
| Bookmarks and private notes on questions | Practice and review | Added in batch 1 |
| Custom practice by topic, new questions, bookmarks | Drills | Added in batch 1 |
| Confidence ratings, lucky guesses, sure-but-wrong | Quiz and results | Added in batch 1 |
| Rule out options, scratchpad | Open attempts | Added in batch 1 |
| Report a bad question, item analysis for authors | Practice, quiz editor | Added in batch 2 |
| Diagnostic ("where do I stand") | Drills, Diagnostic | Added in batch 2 |
| Study time and training hours | Progress, Study time | Added in batch 2 |
| On-screen calculator | Quiz setting | Added in batch 2 |
| Full mock exam to the real domain weights | Exam prep, Mock exam | Added in batch 2 |
| Weak-area drills, readiness estimate, goals | Drills, Progress | Built |
| Exam objectives and coverage map | Coverage tab | Built |
| Credentials, vouchers, renewals, CEU hours | Credentials | Built |
| Exam-day countdown and checklist | Exam day | Built |
| Notes with Obsidian sync | Notes | Built |
| Build a course with any AI assistant | Build, MCP | Built |
| Sharing, groups, SSO, SCIM | Admin | Built |

## Left out on purpose
- **Badges, LinkedIn and Credly:** declined by the owner. Ultimyr never presents completion as a vendor certification.
- **Adaptive (computer adaptive) exams:** few vendors publish how theirs work, so any imitation would be a guess. Mock exams follow published domain weights instead.
- **Cloud labs and sandboxes:** these need provider accounts and spend. Labs are tracked as roadmap steps (a link plus `content-type:lab`) and logged in Study time.
- **Peer percentiles and leaderboards:** one learner per install by design, and rankings would pressure people more than help them.
- **Official score reports:** vendors rarely publish the formula, so scoring profiles say how far each one can be trusted (see quiz.md).

## Batches
1. **Flashcards and practice depth:** cloze deletion, suspend, bury, leeches; bookmarks, private notes, topic drills; confidence, rule-out, scratchpad; glossary.
2. **Question quality and exam realism:** reports and item analysis, diagnostic drill, study time log, calculator, blueprint-weighted mock exam.
3. **Next:** assignments with due dates for groups, study reminders, then another research pass.

Everything above is described in the CHANGELOG with the migrations it adds.
