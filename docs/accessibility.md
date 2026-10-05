# Accessibility, display settings and installing

Ultimyr aims to be comfortable to study with for a long time, including for people with ADHD, dyslexia, low vision or a need for more time.

## Display settings (account menu, Your settings)
| Setting | Options | Notes |
|---|---|---|
| Theme | System, light, dark | Follows the device by default |
| Text size | Normal, large, extra large | Scales the whole interface |
| Easy-read font | Off, on | A wider, more open letter shape with more line spacing |
| Calm mode | Off, on | No animation or motion anywhere |
| Content width | 50 to 100 | Narrower lines are easier to track |

Settings are stored in a small cookie (`ultimyr_display`, no personal data) and applied on the server, so the page never flashes the wrong theme or size. Calm mode also turns on automatically when the device asks for reduced motion.

## Focus mode
A **Focus** button on the study page and the exam page hides the header and everything that is not the card or question. Press it again (or Escape) to leave.

## Extra time
When starting a timed or exam-style quiz, a learner can **declare** extra time: none, 25%, 50% or 100%. The server lengthens the deadline once, at the start, and records the percentage on the attempt (`extraTimePct`). It is self-declared and unchecked, because Ultimyr is a practice tool. Results show a note that extra time was used so scores are not compared unfairly.

## Keyboard and screen readers
- A "Skip to content" link is the first stop on every page. The main region is `#main`.
- Every control works with a keyboard. Flashcards: Space shows the answer, 1 to 4 rate it. Matching questions use drop-down lists instead of dragging.
- Status changes (saved, checked, time warnings) use live regions.
- Automated check: axe-core reported no violations on the main pages (sign in, reading room, archive, study, quiz, attempt, progress, settings) in light and dark themes.
- Lighthouse (mobile profile, local build): accessibility, best practices and SEO scores in the 90s, with good first paint.

This is not a full audit by a person using assistive technology. Please report anything that gets in your way.

## Phones and small screens
- Below 768px the top bar collapses to a search button and a menu button; the menu is a full-screen sheet (Escape or the close button dismisses it).
- Settings and Admin categories become a sideways-scrolling tab row. Archive tabs scroll rather than overflow.
- Touch screens get buttons and inputs at least 40px tall, and inputs use 16px text so iOS does not zoom when one is focused.
- Step notes open full screen below 1024px instead of beside the roadmap.

## Install as an app (PWA)
Browsers offer "Install" because Ultimyr ships a manifest, icons and a service worker.
- **What it does:** opens in its own window, and shows a friendly **offline page** when there is no connection.
- **What it does not do:** study offline. The worker never caches pages, API, OAuth or MCP responses, so nothing private is stored on the device and you never see stale data. Offline study is a possible later phase.

## Example archive
The reading room has an **Add a small example** button. It imports a tiny CompTIA A+ style archive (3 guides, 2 decks, a 16 question quiz) so a new install has something to try. It is clearly marked as not official and not exam content. The first real target is the Claude Architect Foundations exam; its archive will be added once the study guide is supplied.

## Performance budget
`node scripts/check-budgets.mjs` runs in CI after the web build and fails if gzip sizes pass these limits:

| Measure | Budget | Today |
|---|---|---|
| All JavaScript | 450 KB | 424 KB |
| Largest JS chunk | 90 KB | 70 KB |
| CSS | 15 KB | 5 KB |

## Gentler wording
Empty states, saved messages and streaks use encouraging copy ("Nothing due, enjoy the break"). Missing a day never shows a broken-streak warning.
