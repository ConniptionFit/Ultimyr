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
  quiz: { themed: "Trial", plain: "Quiz" },
  exam: { themed: "Rite", plain: "Practice exam" },
  queue: { themed: "Vigil", plain: "Daily review" },
  streak: { themed: "Candle", plain: "Streak" },
  agent: { themed: "The Archivist", plain: "AI assistant" },
  dashboard: { themed: "The Reading Room", plain: "Dashboard" },
  share: { themed: "Lend", plain: "Share" },
  keys: { themed: "Conduits", plain: "API keys & MCP" },
  admin: { themed: "The Stacks", plain: "Admin" },
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
  notFound: {
    themed: "This shelf is empty. The Archive has no record of this page.",
    plain: "Page not found.",
  },
} as const;
export type CopyKey = keyof typeof copy;

export function text(key: CopyKey, mode: NamingMode): string {
  return copy[key][mode];
}
