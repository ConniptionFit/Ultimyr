/**
 * The Ultimyr bundle: a plain text format that any chat assistant can write, for people who cannot (or do not want to)
 * connect it to Ultimyr over MCP. The person pastes the text into Ultimyr, which checks it here and then saves it as
 * drafts. Pure and strict: anything it cannot read exactly becomes an error with a line number, never a guess.
 *
 * A bundle can arrive in several chunks. Every chunk is self-contained; the importer merges them by title.
 */

export const LIMITS = { text: 3_000_000, guide: 500_000, cards: 500, questions: 200, options: 12, title: 160 } as const;

export interface BundleGuide {
  title: string;
  summary: string;
  markdown: string;
  objectiveCodes: string[];
}
export interface BundleCard {
  front: string;
  back: string;
}
export interface BundleDeck {
  title: string;
  summary: string;
  cards: BundleCard[];
  objectiveCodes: string[];
}
export interface BundleQuestion {
  type: "mcq" | "multi" | "fib";
  stem: string;
  payload: Record<string, unknown>;
  key: Record<string, unknown>;
  explanation?: string;
  difficulty?: number;
  objectiveCode?: string;
}
export interface BundleQuiz {
  title: string;
  summary: string;
  questions: BundleQuestion[];
}
export interface Bundle {
  archive: { title?: string; vendor?: string; overview?: string };
  /** Outline text for set_objectives, e.g. "## 1.0 Domain (15%)" then "- 1.1 Objective". */
  objectives: string | null;
  /** Roadmap outline text. */
  roadmap: string | null;
  guides: BundleGuide[];
  decks: BundleDeck[];
  quizzes: BundleQuiz[];
  warnings: string[];
  errors: string[];
}

const OPEN = /^===\s*(objectives|roadmap|guide|deck|quiz)\s*(?::\s*(.*?))?\s*===\s*$/i;
const END = /^===\s*end\s*===\s*$/i;
const FENCE = /^```[\w-]*\s*$/;
const CODE = /^\d[\w.\-]*$/;
const clean = (s: string) => s.trim();
const codes = (s: string) =>
  s
    .split(/[,;]/)
    .map(clean)
    .filter(Boolean);

/** Peel `key: value` header lines (only the given keys) off the top of a block. */
function headers(lines: string[], keys: string[]): { head: Record<string, string>; rest: string[] } {
  const head: Record<string, string> = {};
  let i = 0;
  const re = new RegExp(`^(${keys.join("|")})\\s*:\\s*(.*)$`, "i");
  for (; i < lines.length; i++) {
    const m = re.exec(lines[i]!);
    if (!m) break;
    head[m[1]!.toLowerCase()] = m[2]!.trim();
  }
  while (i < lines.length && lines[i]!.trim() === "") i++;
  return { head, rest: lines.slice(i) };
}

function parseQuestion(type: BundleQuestion["type"], tokens: string, body: string[], err: (m: string) => void, at: number): BundleQuestion | null {
  const bad = (m: string) => (err(`Line ${at}: ${m}`), null);
  let objectiveCode: string | undefined;
  let difficulty: number | undefined;
  for (const t of tokens.split(/\s+/).filter(Boolean)) {
    const d = /^d([1-5])$/i.exec(t);
    if (d) difficulty = Number(d[1]);
    else if (CODE.test(t) && !objectiveCode) objectiveCode = t;
    else return bad(`unexpected "${t}" after Q ${type}. Use an objective code like 1.1 and an optional difficulty like d3.`);
  }
  const stem: string[] = [];
  const options: { id: string; text: string; correct: boolean }[] = [];
  const answers: string[][] = [];
  const why: string[] = [];
  let mode: "stem" | "why" = "stem";
  for (const line of body) {
    const opt = /^([a-l])\)\s+(.*?)(\s+\*)?\s*$/.exec(line);
    const ans = /^Answer\s*:\s*(.*)$/i.exec(line);
    const exp = /^Why\s*:\s*(.*)$/i.exec(line);
    if (exp) {
      mode = "why";
      why.push(exp[1]!);
    } else if (mode === "why") why.push(line);
    else if (opt) options.push({ id: opt[1]!, text: opt[2]!.trim(), correct: !!opt[3] });
    else if (ans) answers.push(ans[1]!.split("|").map(clean).filter(Boolean));
    else if (options.length === 0 && answers.length === 0) stem.push(line);
    else if (line.trim()) return bad(`cannot read "${line.trim().slice(0, 60)}". After the question, write options as "a) text" (add " *" to the correct ones), or "Answer:" lines for fill-in questions.`);
  }
  const stemText = stem.join("\n").trim();
  if (!stemText) return bad("the question has no text.");
  const explanation = why.join("\n").trim() || undefined;
  const base = { stem: stemText, explanation, difficulty, objectiveCode };
  if (type === "fib") {
    const blanks = stemText.match(/_{3,}/g)?.length ?? 0;
    if (blanks === 0) return bad('a fill-in question needs "___" where each blank goes.');
    if (options.length) return bad("a fill-in question has Answer: lines, not options.");
    if (answers.length !== blanks) return bad(`the question has ${blanks} blank${blanks === 1 ? "" : "s"} but ${answers.length} Answer: line${answers.length === 1 ? "" : "s"}.`);
    if (answers.some((a) => a.length === 0)) return bad("an Answer: line is empty.");
    return { type, ...base, payload: { blanks }, key: { blanks: answers.map((accepted) => ({ accepted })) } };
  }
  if (answers.length) return bad("only fill-in questions use Answer: lines.");
  if (options.length < 2) return bad("a choice question needs at least two options.");
  if (options.length > LIMITS.options) return bad(`a question can have at most ${LIMITS.options} options.`);
  if (new Set(options.map((o) => o.id)).size !== options.length) return bad("option letters must be unique.");
  if (options.some((o) => !o.text)) return bad("an option has no text.");
  const right = options.filter((o) => o.correct).map((o) => o.id);
  if (type === "mcq" && right.length !== 1) return bad(`a multiple choice question needs exactly one correct option marked with " *" (found ${right.length}).`);
  if (type === "multi" && right.length < 1) return bad('a select-all question needs at least one correct option marked with " *".');
  return { type, ...base, payload: { options: options.map((o) => ({ id: o.id, text: o.text })) }, key: { correct: type === "mcq" ? right[0] : right } };
}

function parseQuiz(title: string, lines: string[], startLine: number, out: Bundle) {
  const err = (m: string) => out.errors.push(m);
  const { head, rest } = headers(lines, ["summary"]);
  const questions: BundleQuestion[] = [];
  let cur: { type: BundleQuestion["type"]; tokens: string; at: number; body: string[] } | null = null;
  const flush = () => {
    if (!cur) return;
    const q = parseQuestion(cur.type, cur.tokens, cur.body, err, cur.at);
    if (q) questions.push(q);
    cur = null;
  };
  const offset = startLine + (lines.length - rest.length);
  for (const [i, line] of rest.entries()) {
    const m = /^Q\s+(mcq|multi|fib)\b(.*)$/i.exec(line);
    if (m) {
      flush();
      cur = { type: m[1]!.toLowerCase() as BundleQuestion["type"], tokens: m[2]!, at: offset + i, body: [] };
    } else if (cur) cur.body.push(line);
    else if (line.trim()) err(`Line ${offset + i}: expected "Q mcq", "Q multi" or "Q fib" to start a question, found "${line.trim().slice(0, 60)}".`);
  }
  flush();
  if (!questions.length) return err(`Quiz "${title}" has no questions.`);
  if (questions.length > LIMITS.questions) return err(`Quiz "${title}" has ${questions.length} questions in one block. Split it into blocks of ${LIMITS.questions} or fewer.`);
  out.quizzes.push({ title, summary: head.summary ?? "", questions });
}

export function parseBundle(input: string): Bundle {
  const out: Bundle = { archive: {}, objectives: null, roadmap: null, guides: [], decks: [], quizzes: [], warnings: [], errors: [] };
  if (input.length > LIMITS.text) {
    out.errors.push(`The text is longer than ${LIMITS.text.toLocaleString()} characters. Import it in smaller chunks.`);
    return out;
  }
  const lines = input.replace(/\r\n?/g, "\n").split("\n");
  let kind = "";
  let title = "";
  let start = 0;
  let body: string[] = [];
  const text = (l: string[]) => l.join("\n").trim();

  const close = () => {
    const at = start + 1;
    if (!title && kind !== "objectives" && kind !== "roadmap") return out.errors.push(`Line ${start}: a ${kind} block needs a title, like "=== ${kind}: Title ===".`);
    if (title.length > LIMITS.title) return out.errors.push(`Line ${start}: the title "${title.slice(0, 40)}..." is longer than ${LIMITS.title} characters.`);
    if (kind === "objectives") out.objectives = [out.objectives, text(body)].filter(Boolean).join("\n");
    else if (kind === "roadmap") out.roadmap = [out.roadmap, text(body)].filter(Boolean).join("\n");
    else if (kind === "guide") {
      const { head, rest } = headers(body, ["objectives", "summary"]);
      const markdown = text(rest);
      if (!markdown) return out.errors.push(`Guide "${title}" has no text.`);
      if (markdown.length > LIMITS.guide) return out.errors.push(`Guide "${title}" is longer than ${LIMITS.guide.toLocaleString()} characters.`);
      out.guides.push({ title, summary: head.summary ?? "", markdown, objectiveCodes: codes(head.objectives ?? "") });
    } else if (kind === "deck") {
      const { head, rest } = headers(body, ["objectives", "summary"]);
      const cards: BundleCard[] = [];
      const off = at + (body.length - rest.length);
      for (const [i, line] of rest.entries()) {
        if (!line.trim()) continue;
        const k = line.indexOf("::");
        const front = k < 0 ? "" : line.slice(0, k).trim();
        const back = k < 0 ? "" : line.slice(k + 2).trim();
        if (!front || !back) out.errors.push(`Line ${off + i}: write each card as "Question :: Answer" on one line.`);
        else cards.push({ front, back });
      }
      if (!cards.length) return out.errors.push(`Deck "${title}" has no cards.`);
      if (cards.length > LIMITS.cards) return out.errors.push(`Deck "${title}" has ${cards.length} cards in one block. Split it into blocks of ${LIMITS.cards} or fewer.`);
      out.decks.push({ title, summary: head.summary ?? "", cards, objectiveCodes: codes(head.objectives ?? "") });
    } else if (kind === "quiz") parseQuiz(title, body, at, out);
  };

  for (const [i, line] of lines.entries()) {
    const n = i + 1;
    if (kind) {
      if (END.test(line.trim())) {
        close();
        kind = "";
      } else if (OPEN.test(line.trim())) {
        out.errors.push(`Line ${start}: the ${kind} block${title ? ` "${title}"` : ""} was never closed with "=== end ===".`);
        kind = "";
        // Fall through to open the new block below.
      } else {
        body.push(line);
        continue;
      }
      if (kind === "") {
        const m = OPEN.exec(line.trim());
        if (!m) continue;
        kind = m[1]!.toLowerCase();
        title = clean(m[2] ?? "");
        start = n;
        body = [];
      }
      continue;
    }
    const t = line.trim();
    const open = OPEN.exec(t);
    if (open) {
      kind = open[1]!.toLowerCase();
      title = clean(open[2] ?? "");
      start = n;
      body = [];
    } else if (!t || FENCE.test(t) || /^ultimyr-bundle\b/i.test(t)) continue;
    else {
      const h = /^(archive|vendor|overview)\s*:\s*(.*)$/i.exec(t);
      if (h) {
        const key = h[1]!.toLowerCase() as "archive" | "vendor" | "overview";
        out.archive[key === "archive" ? "title" : key] = h[2]!.trim();
      } else out.warnings.push(`Line ${n}: ignored text outside any block: "${t.slice(0, 60)}".`);
    }
  }
  if (kind) out.errors.push(`Line ${start}: the ${kind} block${title ? ` "${title}"` : ""} was never closed with "=== end ===". The chat may have been cut off: ask it to resend that block.`);
  return out;
}

/** What is inside, for the preview. */
export function summarize(b: Bundle) {
  return {
    objectives: b.objectives ? b.objectives.split("\n").filter((l) => /^(##\s|[-*]\s)/.test(l.trim())).length : 0,
    roadmap: b.roadmap ? b.roadmap.split("\n").filter((l) => l.trim()).length : 0,
    guides: b.guides.length,
    decks: b.decks.length,
    cards: b.decks.reduce((s, d) => s + d.cards.length, 0),
    quizzes: b.quizzes.length,
    questions: b.quizzes.reduce((s, q) => s + q.questions.length, 0),
  };
}

/** The format as written for the assistant: rules plus a complete example that this parser accepts (a test checks it). */
export const FORMAT_EXAMPLE = `ultimyr-bundle v1
archive: Example Cert
vendor: Example Vendor
overview: One or two sentences about the certification.

=== objectives ===
## 1.0 Networking (60%)
- 1.1 Explain common ports
- 1.2 Compare TCP and UDP
## 2.0 Security (40%)
- 2.1 Describe the CIA triad
=== end ===

=== roadmap ===
## Week 1: Networking
- [[Ports and protocols]]
- Take the networking quiz (optional)
=== end ===

=== guide: Ports and protocols ===
objectives: 1.1, 1.2
summary: The ports and transport protocols worth knowing.

# Ports and protocols

- HTTPS uses port 443.
- TCP is connection oriented; UDP is not.
=== end ===

=== deck: Networking flashcards ===
objectives: 1.1
What port does HTTPS use? :: 443
Which transport protocol is connectionless? :: UDP
=== end ===

=== quiz: Networking quiz ===
Q mcq 1.1 d2
Which port does HTTPS use by default?
a) 21
b) 443 *
c) 25
Why: HTTPS runs over TLS on port 443.

Q multi 1.2
Which are true of TCP?
a) It is connection oriented *
b) It guarantees delivery *
c) It has no handshake
Why: TCP sets up a connection and retransmits lost data.

Q fib 1.1
HTTPS uses port ___.
Answer: 443
Why: 443 is the registered port.
=== end ===
`;

export const FORMAT_RULES = [
  "Start with: ultimyr-bundle v1, then archive:, vendor: and overview: lines.",
  'Write blocks that open with "=== kind: Title ===" and close with "=== end ===". Kinds: objectives, roadmap, guide, deck, quiz. The objectives and roadmap blocks take no title.',
  "objectives: an outline. '## 1.0 Domain name (15%)' for a domain with its exam weight, then '- 1.1 Objective' lines. Only objectives from the vendor's published exam guide.",
  "roadmap: '## Week 1: Title' stages, then '- [[Guide title]]' lines that name a guide, deck or quiz you wrote, '- [Title](https://link) 20m' for links you opened (YouTube and Vimeo videos play inside Ultimyr), and '- Text (optional)' for checkpoints.",
  "guide: optional 'objectives: 1.1, 1.2' and 'summary:' lines, a blank line, then Markdown.",
  "deck: optional 'objectives:' line, then one card per line as 'Question :: Answer'.",
  "quiz: questions start with 'Q mcq', 'Q multi' or 'Q fib', then an optional objective code and difficulty (d1 to d5). Options are 'a) text' and the correct ones end with ' *'. Fill-in questions use ___ for each blank and one 'Answer: one | another' line per blank. Add 'Why:' for the explanation.",
  "Put the objective code (such as 1.1) on every question and list the objectives on every guide and deck.",
] as const;

/** What "done" means per objective at each depth. Mirrors @ultimyr/coverage's DEPTH (a test keeps them equal). */
export const DEPTH_TARGETS = {
  quick: { cards: 5, questions: 3 },
  standard: { cards: 10, questions: 6 },
  deep: { cards: 20, questions: 12 },
} as const;
export type BundleDepth = keyof typeof DEPTH_TARGETS;

/** Objective codes in an outline ("- 1.1 Explain ports"), in order. */
export function objectiveCodes(outline: string | null): string[] {
  const seen: string[] = [];
  for (const line of (outline ?? "").split("\n")) {
    const m = /^\s*[-*]\s+(\d[\w.\-]*)\b/.exec(line);
    if (m && !seen.includes(m[1]!)) seen.push(m[1]!);
  }
  return seen;
}

export interface Gap {
  code: string;
  guide: boolean;
  cardsMissing: number;
  questionsMissing: number;
}
export interface Check {
  objectives: number;
  complete: number;
  gaps: Gap[];
  /** Codes used on guides, decks or questions that no objective declares (usually a typo). */
  unknownCodes: string[];
  /** Questions with no objective code, which can never count toward coverage. */
  untaggedQuestions: number;
}

/**
 * Compare what was written with what the depth asks for, per objective. Pass every parsed chunk (or one merged
 * Bundle). A later chunk may declare objectives, so declared codes are pooled across all of them.
 */
export function checkBundles(bundles: Bundle[], depth: BundleDepth): Check {
  const want = DEPTH_TARGETS[depth];
  const declared = [...new Set(bundles.flatMap((b) => objectiveCodes(b.objectives)))];
  const guides = new Set<string>();
  const cards = new Map<string, number>();
  const questions = new Map<string, number>();
  const used = new Set<string>();
  let untaggedQuestions = 0;
  for (const b of bundles) {
    for (const g of b.guides) for (const c of g.objectiveCodes) (guides.add(c), used.add(c));
    for (const d of b.decks) {
      // A deck that lists several objectives cannot say which card belongs to which, so split its cards evenly.
      const share = d.objectiveCodes.length ? d.cards.length / d.objectiveCodes.length : 0;
      for (const c of d.objectiveCodes) (cards.set(c, (cards.get(c) ?? 0) + share), used.add(c));
    }
    for (const q of b.quizzes)
      for (const x of q.questions) {
        if (!x.objectiveCode) untaggedQuestions++;
        else (questions.set(x.objectiveCode, (questions.get(x.objectiveCode) ?? 0) + 1), used.add(x.objectiveCode));
      }
  }
  const gaps: Gap[] = [];
  for (const code of declared) {
    const gap: Gap = {
      code,
      guide: !guides.has(code),
      cardsMissing: Math.max(0, want.cards - Math.floor(cards.get(code) ?? 0)),
      questionsMissing: Math.max(0, want.questions - (questions.get(code) ?? 0)),
    };
    if (gap.guide || gap.cardsMissing || gap.questionsMissing) gaps.push(gap);
  }
  return {
    objectives: declared.length,
    complete: declared.length - gaps.length,
    gaps,
    unknownCodes: declared.length ? [...used].filter((c) => !declared.includes(c)) : [],
    untaggedQuestions,
  };
}

/**
 * The fixed way a chat builds a certification, so two runs (or two chats, or a Claude Skill and a pasted prompt) end up with
 * the same structure. The prompt, the skill and the docs all read these lists; change them here only.
 */

/** Passes run in this order. Each ends with a finished chunk the person pastes before saying "next". */
export const PASSES = [
  { id: "R", name: "Research", what: "Search the web and open sources yourself. Do not wait for me. Report a short research summary with every source you used, then continue to pass A." },
  { id: "A", name: "Objectives and roadmap", what: "Header, the objectives block (every domain with its weight, every objective with its code) and the roadmap block. No guides yet." },
  { id: "B", name: "One domain at a time", what: "For ONE exam domain: one guide per objective group, one deck, one quiz. Never more than one domain per reply." },
  { id: "C", name: "Gap fill", what: "Only the objectives Ultimyr reported as short. Same block titles as before so nothing duplicates." },
] as const;

/** Content standards that make runs comparable. */
export const STANDARDS = {
  research: [
    "Find and open: (1) the official exam guide or objectives page with domains, weights and numbering, (2) the exam facts (format, number and types of questions, time, passing score, price, retake policy, delivery, current version and retirement date), (3) the vendor's own training, free courses, docs, demos and sample questions, (4) the suggested study order, (5) the most recommended community guides, courses and videos, (6) what people who passed report about format, difficulty and which topics matter most.",
    "Trust order: official vendor pages, then vendor docs, then established training sites and instructors, then forums and posts. A single anecdote is not a fact: only use a community claim when several sources agree, and say it is community reported.",
    "Finish research with a short summary: exam facts with their sources, the source list (title, link, what it is for), the order you will teach in, and anything you could not confirm.",
  ],
  coursework: [
    "The vendor guide is the skeleton, not the text. Teach the same objectives in your own words and add what a vendor guide lacks: worked examples, scenarios, comparisons, common mistakes and community-reported tips. Never copy vendor text or copyrighted course material.",
    "If the vendor guide is broad, weave practice into the course: end each guide with its 'Check yourself' prompts, and place the matching flashcard deck and a short quiz right after it in the roadmap, so the learner reads, recalls, then tests.",
    "Practice tests and flashcards come from the same objectives and the same research, so they align with the guides, but they are never copies of them or of real exam questions. Mirror the real exam's reported format (question types, scenario style, length, difficulty mix) and stress the topics people report as heavily tested.",
  ],
  videos: [
    "Add real videos and playlists you opened (official demos and the best-regarded community courses) as roadmap links, '- [Title](https://youtu.be/...) 25m', placed at the step they support. YouTube and Vimeo links play inside Ultimyr. Only use a link you actually opened; never guess one.",
  ],
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
    "Objectives, weights, passing score, price, question counts, time limit and dates come from sources you opened this session, with the official exam guide above all. Name the source for each in the research summary. If sources disagree, say so and prefer the official one. If a fact is unconfirmed, label it 'unconfirmed' or leave it out. Never invent a link.",
    "Only if you cannot browse, or cannot find the official objectives after a real search, say so once and ask me to paste them. Never stop to ask for anything you can look up.",
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
    ...block("Research", STANDARDS.research),
    ...block("Coursework", STANDARDS.coursework),
    ...block("Videos", STANDARDS.videos),
    ...block("Guides", STANDARDS.guide),
    ...block("Flashcards", STANDARDS.deck),
    ...block("Quiz questions", STANDARDS.quiz),
    ...block("Roadmap", STANDARDS.roadmap),
  ];
}
