/**
 * Naming dictionary. Every lore term has a plain equivalent, so the themed
 * names can be switched off in settings and the function of each concept is
 * always clear. API routes and integrations always use the plain names.
 */
export type NamingMode = "themed" | "plain";

export const NAMING_COOKIE = "ultimyr_naming";
export const DEFAULT_NAMING: NamingMode = "plain";

export const terms = {
  archive: { themed: "Archive", plain: "Course" },
  archives: { themed: "Archives", plain: "Courses" },
  guide: { themed: "Tome", plain: "Study guide" },
  deck: { themed: "Grimoire", plain: "Flashcard deck" },
  card: { themed: "Rune", plain: "Flashcard" },
  roadmap: { themed: "Labyrinth", plain: "Roadmap" },
  resources: { themed: "Secret Shop", plain: "Resources" },
  quiz: { themed: "Duel", plain: "Quiz" },
  exam: { themed: "Aghanim's Trial", plain: "Practice exam" },
  queue: { themed: "Refresher", plain: "Daily review" },
  streak: { themed: "Killing Spree", plain: "Streak" },
  agent: { themed: "The Curator", plain: "AI assistant" },
  dashboard: { themed: "The Fountain", plain: "Dashboard" },
  share: { themed: "Courier", plain: "Share" },
  keys: { themed: "Twin Gates", plain: "API keys & MCP" },
  admin: { themed: "The Warden", plain: "Admin" },
  prep: { themed: "Strategy Time", plain: "Exam prep" },
  credentials: { themed: "Aegis", plain: "Credentials" },
  drills: { themed: "Dust of Appearance", plain: "Weak-area drills" },
  coverage: { themed: "Observer Wards", plain: "Coverage" },
  build: { themed: "Commission the Curator", plain: "Build with an AI assistant" },
  groupAccess: { themed: "Party Access", plain: "Group access" },
  about: { themed: "Lore", plain: "About this app" },
  services: { themed: "Towers", plain: "Services" },
  countdown: { themed: "Roshan Timer", plain: "Exam countdown" },
  continue: { themed: "Town Portal", plain: "Continue" },
  session: { themed: "Farming Route", plain: "Today's session" },
  stages: { themed: "Minimap", plain: "Stages" },
  stats: { themed: "Scoreboard", plain: "Your stats" },
  noteSearch: { themed: "Scan", plain: "Search" },
  offline: { themed: "Backpack", plain: "Offline copy" },
  copyRoadmap: { themed: "Tempest Double", plain: "Copy" },
} as const;
export type TermKey = keyof typeof terms;

/**
 * Where each themed name comes from. Themed names must follow Dota 2 lore and
 * say what the element does (see docs/naming.md). `source` points at the lore
 * or in-game thing the name borrows from; `function` is what it does here.
 */
export const termLore: Record<TermKey, { source: string; function: string }> = {
  archive: { source: "Arcane Archives of Ultimyr Academy (Warlock lore)", function: "A course: everything you study for one certification." },
  archives: { source: "Arcane Archives of Ultimyr Academy (Warlock lore)", function: "Your list of courses." },
  guide: { source: "Rare tomes hunted by Demnok Lannik; Tome of Knowledge item", function: "A study guide you read." },
  deck: { source: "The Black Grimoire, Demnok Lannik's book of gathered knowledge", function: "A deck of flashcards." },
  card: { source: "Runes, small packets of power that return on a timer", function: "One flashcard." },
  roadmap: { source: "Aghanim's Labyrinth, rooms cleared in order toward the final boss", function: "An ordered route of steps toward the exam." },
  resources: { source: "Secret Shop, which stocks what the base shop does not", function: "Outside links: videos, articles, courses." },
  quiz: { source: "Duel, Legion Commander's one-on-one challenge", function: "A short quiz that checks what you know." },
  exam: { source: "Aghanim's Trials, the timed, scored challenge", function: "A timed practice exam." },
  queue: { source: "Refresher Orb, which resets cooldowns", function: "The cards due for review today." },
  streak: { source: "Killing Spree, the announcer's consecutive-kill call", function: "Days in a row you studied." },
  agent: { source: "Demnok Lannik, Chief Curator of the Arcane Archives", function: "The AI assistant that finds and builds material." },
  dashboard: { source: "The Fountain, your base where you return and recover", function: "Home page with what to do next." },
  share: { source: "Courier, which delivers items to allies", function: "Give another person access to an item." },
  keys: { source: "Twin Gates, which link two distant points on the map", function: "API keys and the MCP connection to outside AI tools." },
  admin: { source: "Demnok Lannik, the archives' watchful warden", function: "Administration: users, settings, access." },
  prep: { source: "Strategy Time, the planning phase before a match", function: "Exam prep: credentials, drills, coverage, countdown." },
  credentials: { source: "Aegis of the Immortal, the prize for slaying Roshan", function: "Certifications you hold or are chasing." },
  drills: { source: "Dust of Appearance, which reveals what is hidden", function: "Practice aimed at your weakest areas." },
  coverage: { source: "Observer Ward, which gives vision over an area", function: "Which exam objectives your material covers." },
  build: { source: "Demnok Lannik, Head of Acquisitions for the Arcane Archives", function: "Have an AI assistant build a course for you." },
  groupAccess: { source: "Party, the group you play with", function: "Which groups can view or manage which courses." },
  about: { source: "Lore, the history tab on a hero's page", function: "App name, version, license and links." },
  services: { source: "Towers, the buildings that guard each lane; each one either stands or has fallen", function: "Whether each part of Ultimyr is running." },
  countdown: { source: "Roshan's respawn timer, the clock toward the big fight", function: "Days until your real exam." },
  continue: { source: "Town Portal Scroll, teleports you back to a friendly building", function: "Jump back to the step you left off at." },
  session: { source: "Farming Route, the camps a hero clears in the time available", function: "Pick today's minutes and see which steps fit." },
  stages: { source: "Minimap, the whole map at a glance, click to jump", function: "The stages of a roadmap, with progress, to jump between." },
  stats: { source: "Scoreboard, a hero's running numbers in a match", function: "Your streak, readiness and weakest area for this course." },
  noteSearch: { source: "Scan, the ability that reveals a chosen area of the map", function: "Search your own notes for a course." },
  offline: { source: "Backpack, items a hero carries without equipping", function: "Keep a copy of a guide or deck to read without a connection." },
  copyRoadmap: { source: "Tempest Double (Arc Warden), a copy that carries the original's items and abilities", function: "Copy a roadmap from another course." },
};

export function term(key: TermKey, mode: NamingMode): string {
  return terms[key][mode];
}

export function parseNamingMode(value: string | undefined | null): NamingMode {
  return value === "plain" || value === "themed" ? value : DEFAULT_NAMING;
}

/** Micro-copy. Tone: quiet, dry, a little wry, never cute. */
export const copy = {
  splashTitle: { themed: "A quiet place to know things.", plain: "Study smarter. Pass with confidence." },
  splashCta: { themed: "Enter the Archives", plain: "Get started" },
  splashSub: {
    themed: "Guides, flashcards and exams, kept in order and ready when you are.",
    plain: "Guides, flashcards and practice exams, organised and ready when you are.",
  },
  emptyArchives: {
    themed: "Nothing shelved yet. Begin with a single page.",
    plain: "No courses yet. Create your first one to get started.",
  },
  signingIn: { themed: "Opening the door...", plain: "Signing in..." },
  signedOut: { themed: "Door closed behind you.", plain: "You have been signed out." },
  loginTitle: { themed: "Return to the Archives", plain: "Sign in" },
  registerTitle: { themed: "Request a reading card", plain: "Create your account" },
  loginError: { themed: "That name and passphrase do not match our records.", plain: "Incorrect email or password." },
  loading: { themed: "Fetching from the stacks...", plain: "Loading..." },
  saved: { themed: "Committed to memory.", plain: "Saved." },
  deckDone: { themed: "Committed to memory.", plain: "Nice work. Deck finished." },
  deleteConfirm: {
    themed: "Strike this from the Archives? You can recover it for 30 days.",
    plain: "Delete this? You can recover it from the trash for 30 days.",
  },
  emptyItems: {
    themed: "Nothing shelved yet. Begin with a single page.",
    plain: "Nothing here yet. Add a guide, deck or quiz.",
  },
  emptyRoadmap: {
    themed: "No labyrinth has been mapped yet.",
    plain: "No roadmap yet.",
  },
  roadmapDone: { themed: "Every required room cleared. Well done.", plain: "Every required step is done. Nice work." },
  emptyResources: {
    themed: "The Secret Shop is empty. Add a link to a talk, a page or a course.",
    plain: "No resources yet. Add a link to a video, article or course.",
  },
  emptySearch: { themed: "Nothing on the shelves matches that.", plain: "No results." },
  caughtUp: { themed: "That is everything for now.", plain: "You are all caught up." },
  nothingDue: { themed: "Nothing is due. The Refresher is quiet.", plain: "Nothing is due." },
  rateQuestion: { themed: "How firmly did the rune come back to you?", plain: "How well did you remember?" },
  rateExplain: {
    themed: "Your answer sets when this rune spawns again. The time under each choice is when you will see it next.",
    plain: "Your answer sets when you see this card again. The time under each choice is when it comes back.",
  },
  continueResume: { themed: "Town Portal to where you left off", plain: "Continue where you left off" },
  todayBadge: { themed: "On route", plain: "Today" },
  offlineKeep: { themed: "Stow in the Backpack for offline reading", plain: "Keep for offline reading" },
  offlineDrop: { themed: "Take out of the Backpack", plain: "Remove the offline copy" },
  rateAgain: { themed: "Slipped away. Returns shortly.", plain: "Forgot it. Comes back soon." },
  rateHard: { themed: "Faint. Returns sooner than usual.", plain: "Barely remembered. Comes back sooner." },
  rateGood: { themed: "Recalled. Returns on the usual schedule.", plain: "Remembered. Normal gap." },
  rateEasy: { themed: "Effortless. Rests for longer.", plain: "Instant. Waits longer than usual." },
  attemptGap: { themed: "A gap, found. Better now than on exam day.", plain: "Here is what to review before the exam." },
  aiThinking: { themed: "The Curator is consulting the Archives.", plain: "The assistant is thinking..." },
  vaultNote: {
    themed: "Your keys are sealed. They are never shown again.",
    plain: "Your keys are encrypted and never shown again.",
  },
  notFound: {
    themed: "This shelf is empty. The Archive has no record of this page.",
    plain: "Page not found.",
  },
} as const;
export type CopyKey = keyof typeof copy;

/** "Killing spree: 12 days." / "12 days in a row.". */
export function streakText(days: number, mode: NamingMode): string {
  if (days <= 0) return mode === "themed" ? "No killing spree yet." : "No streak yet.";
  const unit = days === 1 ? "day" : "days";
  return mode === "themed" ? `Killing spree: ${days} ${unit}.` : `${days} ${unit} in a row.`;
}

export function text(key: CopyKey, mode: NamingMode): string {
  return copy[key][mode];
}
