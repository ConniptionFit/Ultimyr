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
  guide: { themed: "Codex", plain: "Study guide" },
  deck: { themed: "Folio", plain: "Flashcard deck" },
  card: { themed: "Leaf", plain: "Flashcard" },
  roadmap: { themed: "Path", plain: "Roadmap" },
  resources: { themed: "References", plain: "Resources" },
  quiz: { themed: "Trial", plain: "Quiz" },
  exam: { themed: "Rite", plain: "Practice exam" },
  queue: { themed: "Vigil", plain: "Daily review" },
  streak: { themed: "Candle", plain: "Streak" },
  agent: { themed: "The Archivist", plain: "AI assistant" },
  dashboard: { themed: "The Reading Room", plain: "Dashboard" },
  share: { themed: "Lend", plain: "Share" },
  keys: { themed: "Conduits", plain: "API keys & MCP" },
  admin: { themed: "The Stacks", plain: "Admin" },
  prep: { themed: "Preparations", plain: "Exam prep" },
  credentials: { themed: "Sigils", plain: "Credentials" },
  drills: { themed: "Whetstone", plain: "Weak-area drills" },
  coverage: { themed: "Atlas", plain: "Coverage" },
  build: { themed: "Commission the Archivist", plain: "Build with an AI assistant" },
  about: { themed: "Colophon", plain: "About this app" },
  countdown: { themed: "The Eve", plain: "Exam countdown" },
} as const;
export type TermKey = keyof typeof terms;

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
    themed: "No path has been laid yet.",
    plain: "No roadmap yet.",
  },
  roadmapDone: { themed: "Every required step walked. Well done.", plain: "Every required step is done. Nice work." },
  emptyResources: {
    themed: "No references shelved. Add a link to a talk, a page or a course.",
    plain: "No resources yet. Add a link to a video, article or course.",
  },
  emptySearch: { themed: "Nothing on the shelves matches that.", plain: "No results." },
  caughtUp: { themed: "That is everything for now.", plain: "You are all caught up." },
  nothingDue: { themed: "Nothing is due. The shelves are quiet.", plain: "Nothing is due." },
  attemptGap: { themed: "A gap, found. Better now than on exam day.", plain: "Here is what to review before the exam." },
  aiThinking: { themed: "The Archivist is consulting the shelves.", plain: "The assistant is thinking..." },
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

/** "Candle lit for 12 days." / "12 day streak". */
export function streakText(days: number, mode: NamingMode): string {
  if (days <= 0) return mode === "themed" ? "No candle lit yet." : "No streak yet.";
  const unit = days === 1 ? "day" : "days";
  return mode === "themed" ? `Candle lit for ${days} ${unit}.` : `${days} ${unit} in a row.`;
}

export function text(key: CopyKey, mode: NamingMode): string {
  return copy[key][mode];
}
