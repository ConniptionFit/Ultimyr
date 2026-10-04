import { z } from "zod";

const id = z.string().min(1).max(64);
const text = z.string().max(5_000);
const option = z.object({ id, text });

export const mcqSchema = z.object({
  type: z.literal("mcq"),
  payload: z.object({ options: z.array(option).min(2).max(12) }),
  key: z.object({ correct: id }),
});
export const multiSchema = z.object({
  type: z.literal("multi"),
  payload: z.object({ options: z.array(option).min(2).max(12), select: z.number().int().min(1).max(12).optional() }),
  key: z.object({ correct: z.array(id).min(1).max(12) }),
});
const blankKey = z.object({
  accepted: z.array(text).max(50).default([]),
  numeric: z.object({ value: z.number(), tolerance: z.number().min(0).default(0) }).optional(),
  regex: z.string().max(100).optional(),
  caseSensitive: z.boolean().default(false),
});
export const fibSchema = z.object({
  type: z.literal("fib"),
  payload: z.object({ blanks: z.number().int().min(1).max(20) }),
  key: z.object({ blanks: z.array(blankKey).min(1).max(20) }),
});
export const dndSchema = z.object({
  type: z.literal("dnd"),
  payload: z.object({ items: z.array(option).min(1).max(20), targets: z.array(option).min(1).max(20) }),
  key: z.object({ mapping: z.record(z.string(), z.string()) }),
});
const assertion = z.object({
  id,
  label: z.string().max(300).default(""),
  /** Dotted path into the submitted end state, for example `firewall.rules.0.port`. */
  path: z.string().min(1).max(200),
  op: z.enum(["eq", "neq", "in", "contains", "gte", "lte", "matches"]),
  value: z.unknown(),
  weight: z.number().int().min(1).max(1000).default(1),
});
export const pbqSchema = z.object({
  type: z.literal("pbq"),
  payload: z.object({ title: z.string().max(300).default(""), instructions: z.string().max(10_000).default(""), scenario: z.unknown().optional() }),
  key: z.object({ assertions: z.array(assertion).min(1).max(100) }),
});

export const questionBodySchema = z.discriminatedUnion("type", [mcqSchema, multiSchema, fibSchema, dndSchema, pbqSchema]);

export const questionMeta = z.object({
  id,
  /** Whole-number weight. A question is worth `weight * 1000` milli-points. */
  weight: z.number().int().min(1).max(100).default(1),
  domain: z.string().max(100).nullish(),
  isPretest: z.boolean().default(false),
});

export type QuestionBody = z.infer<typeof questionBodySchema>;
export type Question = z.infer<typeof questionMeta> & QuestionBody;
export type QuestionType = Question["type"];
export const QUESTION_TYPES = ["mcq", "multi", "fib", "dnd", "pbq"] as const;
export const POINTS_PER_WEIGHT = 1000;

export function parseQuestion(input: unknown): Question {
  const meta = questionMeta.parse(input);
  const body = questionBodySchema.parse(input);
  return { ...meta, ...body } as Question;
}

/** Cross-field checks a schema cannot express. Returns human readable problems; empty means valid. */
export function questionProblems(q: QuestionBody): string[] {
  const out: string[] = [];
  const dup = (ids: string[]) => new Set(ids).size !== ids.length;
  if (q.type === "mcq" || q.type === "multi") {
    const ids = q.payload.options.map((o) => o.id);
    if (dup(ids)) out.push("option ids must be unique");
    const correct = q.type === "mcq" ? [q.key.correct] : q.key.correct;
    for (const c of correct) if (!ids.includes(c)) out.push(`correct answer ${c} is not an option`);
    if (q.type === "multi") {
      if (dup(q.key.correct)) out.push("correct answers must be unique");
      if (q.payload.select !== undefined && q.payload.select !== q.key.correct.length) out.push("select must equal the number of correct answers");
      if (q.key.correct.length >= ids.length) out.push("at least one option must be wrong");
    }
  }
  if (q.type === "fib") {
    if (q.key.blanks.length !== q.payload.blanks) out.push("key must describe every blank");
    q.key.blanks.forEach((b, i) => {
      if (!b.accepted.length && !b.numeric && !b.regex) out.push(`blank ${i + 1} has no accepted answer`);
      if (b.regex && unsafeRegex(b.regex)) out.push(`blank ${i + 1} has an unsafe pattern`);
    });
  }
  if (q.type === "dnd") {
    const items = q.payload.items.map((i) => i.id);
    const targets = q.payload.targets.map((t) => t.id);
    if (dup(items) || dup(targets)) out.push("item and target ids must be unique");
    for (const it of items) if (!(it in q.key.mapping)) out.push(`item ${it} has no target in the key`);
    for (const [k, v] of Object.entries(q.key.mapping)) {
      if (!items.includes(k)) out.push(`key mentions unknown item ${k}`);
      if (!targets.includes(v)) out.push(`key mentions unknown target ${v}`);
    }
  }
  if (q.type === "pbq") {
    const ids = q.key.assertions.map((a) => a.id);
    if (dup(ids)) out.push("assertion ids must be unique");
    for (const a of q.key.assertions) if (a.op === "matches" && (typeof a.value !== "string" || unsafeRegex(a.value))) out.push(`assertion ${a.id} has an unsafe or non-text pattern`);
  }
  return out;
}

/** Reject patterns with nested quantifiers, the classic catastrophic backtracking shape. */
export function unsafeRegex(p: string): boolean {
  if (p.length > 100) return true;
  try {
    new RegExp(p);
  } catch {
    return true;
  }
  return /\((?:[^()\\]|\\.)*[+*](?:[^()\\]|\\.)*\)[+*{]/.test(p) || /\\[1-9]/.test(p);
}

/** The question as a learner may see it: the answer key and anything derived from it removed. */
export function publicQuestion(q: Question) {
  const { key: _key, ...rest } = q;
  void _key;
  return rest;
}
