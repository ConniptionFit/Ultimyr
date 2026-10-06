# Naming convention

Ultimyr has two name sets for the same things. **Plain names** (Course, Study guide, Flashcard) are the default and are the only names used in APIs, MCP tools, database columns and exports. **Themed names** are UI labels a person turns on in Settings > Themed names. They live in `packages/lore` (`terms`), with where each comes from in `termLore`.

## Rules for themed names
1. **Dota 2 lore only.** Use heroes, items, places, factions or in-game mechanics from Dota 2. The anchor is Ultimyr Academy and its Arcane Archives (Warlock lore: Demnok Lannik is Chief Curator, Head of Acquisitions and warden of the archives). Do not invent names.
2. **Research first.** Before adding a name, look it up (Liquipedia, the Dota 2 wiki, the hero's lore page) and confirm what it is and does in the game. Write the finding in `termLore` as `source`.
3. **The function must be obvious.** The name should hint at what the element does (Refresher resets the clock on what you know; Observer Wards give vision over the map, so they show coverage). Settings > Themed names > See all names shows the `function` line beside each name, so write it plainly.
4. **Every new UI element ships with its themed name in the same PR**, wired through `useNaming` (`t` for names, `copy` for sentences) with the plain wording unchanged. Do not merge a plain-only element.
5. **Every themed name has a plain name**, and themed names are not reused for two things. Tests enforce both, and that every term has a `termLore` entry.
6. **Micro-copy** in `copy` follows the same lore and the same tone: quiet, dry, a little wry, never cute. No em dashes.
7. Themed names never appear in URLs, API fields, MCP tool names or exports.

## Names
| Plain name | Themed name | Function | Lore source |
|---|---|---|---|
| Course | Archive | Everything you study for one certification | Arcane Archives of Ultimyr Academy (Warlock) |
| Study guide | Tome | A guide you read | Rare tomes hunted by Demnok Lannik; Tome of Knowledge item |
| Flashcard deck | Grimoire | A deck of flashcards | The Black Grimoire, Demnok Lannik's book of gathered knowledge |
| Flashcard | Rune | One flashcard | Runes, small packets of power that return on a timer |
| Roadmap | Labyrinth | Ordered route of steps to the exam | Aghanim's Labyrinth, rooms cleared in order toward a final boss |
| Resources | Secret Shop | Outside links: videos, articles, courses | Secret Shop, stocks what the base shop does not |
| Quiz | Duel | Short check of what you know | Legion Commander's Duel |
| Practice exam | Aghanim's Trial | Timed, scored practice exam | Aghanim's Trials, the timed leaderboard challenge |
| Daily review | Refresher | Cards due for review today | Refresher Orb, resets cooldowns |
| Streak | Killing Spree | Days in a row you studied | The announcer's Killing Spree call |
| AI assistant | The Curator | Finds and builds material | Demnok Lannik, Chief Curator of the Arcane Archives |
| Dashboard | The Fountain | Home page, what to do next | The Fountain, your base |
| Share | Courier | Give another person access | Courier, delivers items to allies |
| API keys & MCP | Twin Gates | Link Ultimyr to outside AI tools | Twin Gates, link two distant points on the map |
| Admin | The Warden | Users, settings, access | Demnok Lannik, the archives' watchful warden |
| Exam prep | Strategy Time | Credentials, drills, coverage, countdown | Strategy Time, the planning phase before a match |
| Credentials | Aegis | Certifications you hold or chase | Aegis of the Immortal, the prize for slaying Roshan |
| Weak-area drills | Dust of Appearance | Practice aimed at your weakest areas | Dust of Appearance reveals what is hidden |
| Coverage | Observer Wards | Which exam objectives your material covers | Observer Ward, vision over an area |
| Build with an AI assistant | Commission the Curator | Have an assistant build a course | Demnok Lannik, Head of Acquisitions |
| Group access | Party Access | Which groups see which courses | Party, the group you play with |
| About this app | Lore | Name, version, license, links | Lore, the history tab on a hero's page |
| Services | Towers | Whether each part of Ultimyr is running | Towers guard each lane and either stand or have fallen |
| Exam countdown | Roshan Timer | Days until your real exam | Roshan's respawn timer |
| Continue (button) | Town Portal | Jump back to the step you left off at | Town Portal Scroll, teleports you to a friendly building |
| Today's session | Farming Route | Pick today's minutes and see which steps fit (badge: On route) | Farming route, the camps a hero clears in the time available |
| Stage bar | Minimap | Stages of a roadmap with progress, click to jump | Minimap, the whole map at a glance |
| Streak, readiness and weakest area line | Scoreboard | Your running numbers for this course | Scoreboard, a hero's numbers in a match |
| Search notes | Scan | Search your own notes for a course | Scan, reveals a chosen area of the map |
| Offline reading | Backpack | Keep a copy of a guide or deck to read without a connection | Backpack, items a hero carries without equipping |
| Copy a roadmap from another course | Tempest Double | Copy a roadmap | Arc Warden's Tempest Double, a copy that carries the original's items and abilities |

The story the names tell: study in the Archives (Tomes, Grimoires, Runes), practise in Aghanim's Trial, face the real exam like Roshan, and earn the Aegis.

## Adding a name
1. Research and confirm the lore.
2. Add the plain and themed name to `terms`, and the source and function to `termLore` in `packages/lore/src/index.ts`.
3. Add this table row, run `pnpm --filter @ultimyr/lore test`, and note it in the CHANGELOG.
