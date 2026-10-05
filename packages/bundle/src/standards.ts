import { DEPTH_TARGETS, type BundleDepth } from "./index.js";

/**
 * The fixed way a chat builds a certification, so two runs (or two chats, or a Claude Skill and a pasted prompt) end up with
 * the same structure. The prompt, the skill and the docs all read these lists; change them here only.
 */

/** Passes run in this order. Each ends with a finished chunk the person pastes before saying "next". */
export const PASSES = [
  { id: "A", name: "Objectives and roadmap", what: "Header, the objectives block (every domain with its weight, every objective with its code) and the roadmap block. No guides yet." },
  { id: "B", name: "One domain at a time", what: "For ONE exam domain: one guide per objective group, one deck, one quiz. Never more than one domain per reply." },
  { id: "C", name: "Gap fill", what: "Only the objectives Ultimyr reported as short. Same block titles as before so nothing duplicates." },
] as const;

/** Content standards that make runs comparable. */
export const STANDARDS = {
  guide: [
    "One guide per objective group (2 to 5 related objectives), titled for what the learner can do, such as 'Configure and troubleshoot DNS'.",
    "Always this shape: '# Title', then '## Why it matters' (2 sentences), '## Key ideas' (bullets, each a fact), '## How it shows up on the exam' (what is tested and how, without quoting questions), '## Watch out' (3 or more common mix-ups), '## Check yourself' (3 recall prompts without answers).",
    "Name the objective codes covered in the 'objectives:' line. Keep each guide under about 1,200 words.",
  ],
  deck: [
    "One deck per domain, titled '<Domain> flashcards'. One idea per card, front is a question or cue, back is the shortest correct answer (one line).",
    "No card may depend on another card. No yes/no cards. No trick wording.",
    "List the objective codes on the deck. Cards for several objectives are fine; spread them evenly.",
  ],
  quiz: [
    "One quiz per domain, titled '<Domain> quiz'. Tag every question with its objective code and a difficulty d1 to d5.",
    "Spread difficulty: about 30% d1 to d2, 50% d3, 20% d4 to d5. Mix types: mostly mcq, some multi, a few fib.",
    "mcq has exactly one correct option and 3 or 4 options. Wrong options must be plausible and similar in length. No 'all of the above' or 'none of the above'.",
    "Every question has a 'Why:' line explaining the right answer and, where useful, why the best wrong option is wrong.",
    "Write new questions in your own words. Never reproduce real exam questions or braindumps.",
  ],
  roadmap: [
    "Stages by week, in a sensible learning order. Required steps first, then '(optional)' extras. Each stage ends with its domain quiz.",
    "Link guides, decks and quizzes with [[Exact Title]]. Add outside links only if the person gave them or you opened them.",
  ],
  truth: [
    "Objectives, weights, passing score, price, question counts and dates come only from the official exam guide the person pasted or a page you opened. If you have none, ask and stop.",
    "If you are unsure of a fact, leave it out and say so at the end of the chunk. Never invent a link.",
  ],
} as const;

/** Per-objective counts as a sentence. */
export function depthWords(depth: BundleDepth): string {
  const t = DEPTH_TARGETS[depth];
  return `at least ${t.cards} flashcards and ${t.questions} questions per objective`;
}

/** The rules as plain lines, shared by the pasted prompt and the skill. */
export function standardsLines(): string[] {
  const block = (h: string, l: readonly string[]) => [`${h}:`, ...l.map((x) => `- ${x}`), ""];
  return [
    ...block("Truth", STANDARDS.truth),
    ...block("Guides", STANDARDS.guide),
    ...block("Flashcards", STANDARDS.deck),
    ...block("Quiz questions", STANDARDS.quiz),
    ...block("Roadmap", STANDARDS.roadmap),
  ];
}
