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
  "roadmap: '## Week 1: Title' stages, then '- [[Guide title]]' lines that name a guide, deck or quiz you wrote, '- [Title](https://link) 20m' for links you were given, and '- Text (optional)' for checkpoints.",
  "guide: optional 'objectives: 1.1, 1.2' and 'summary:' lines, a blank line, then Markdown.",
  "deck: optional 'objectives:' line, then one card per line as 'Question :: Answer'.",
  "quiz: questions start with 'Q mcq', 'Q multi' or 'Q fib', then an optional objective code and difficulty (d1 to d5). Options are 'a) text' and the correct ones end with ' *'. Fill-in questions use ___ for each blank and one 'Answer: one | another' line per blank. Add 'Why:' for the explanation.",
  "Put the objective code (such as 1.1) on every question and list the objectives on every guide and deck.",
] as const;
