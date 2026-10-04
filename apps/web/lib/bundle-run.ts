import type { Bundle, BundleQuestion } from "@ultimyr/bundle";

export type Api = <T = unknown>(method: string, path: string, body?: unknown) => Promise<T>;

export interface RunResult {
  archiveId: string;
  created: { guides: number; decks: number; cards: number; quizzes: number; questions: number; roadmap: boolean; objectives: boolean };
  skipped: string[];
  warnings: string[];
}

interface Node {
  id: string;
  code: string;
  children?: Node[];
}
const key = (s: string) => s.trim().toLowerCase();

/**
 * Save a checked bundle into an archive through the same API the app uses, everything as drafts to review. Safe to
 * run twice: guides and decks that already exist (same title) are not duplicated, cards and questions already in an
 * existing deck or quiz are skipped. Stops at the first failure and says how far it got.
 */
export async function runBundle(api: Api, b: Bundle, target: { archiveId?: string }, step: (label: string) => void = () => {}): Promise<RunResult> {
  const result: RunResult = { archiveId: target.archiveId ?? "", created: { guides: 0, decks: 0, cards: 0, quizzes: 0, questions: 0, roadmap: false, objectives: false }, skipped: [], warnings: [] };

  if (!result.archiveId) {
    if (!b.archive.title) throw new Error("The bundle has no archive: line, so choose an existing archive to add it to.");
    step(`Creating the archive "${b.archive.title}"`);
    const a = await api<{ id: string }>("POST", "archives", { title: b.archive.title, overview: b.archive.overview ?? "", vendor: b.archive.vendor || undefined });
    result.archiveId = a.id;
  }
  const id = result.archiveId;

  if (b.objectives) {
    step("Saving the exam objectives");
    const r = await api<{ warnings?: string[] }>("POST", `archives/${id}/objectives/import`, { text: b.objectives, replace: false });
    result.created.objectives = true;
    result.warnings.push(...(r.warnings ?? []));
  }

  const codeToId = new Map<string, string>();
  const usesCodes = b.guides.some((g) => g.objectiveCodes.length) || b.decks.some((d) => d.objectiveCodes.length) || b.quizzes.some((q) => q.questions.some((x) => x.objectiveCode));
  if (usesCodes) {
    const tree = await api<{ objectives: Node[] }>("GET", `archives/${id}/objectives`);
    const walk = (n: Node) => {
      codeToId.set(key(n.code), n.id);
      n.children?.forEach(walk);
    };
    tree.objectives.forEach(walk);
  }
  const resolve = (where: string, list: string[]): string[] => {
    const ids: string[] = [];
    for (const c of list) {
      const oid = codeToId.get(key(c));
      if (oid) ids.push(oid);
      else result.warnings.push(`${where}: there is no objective ${c}, so it was not linked.`);
    }
    return ids;
  };
  const link = async (itemId: string, where: string, codes: string[]) => {
    const ids = resolve(where, codes);
    if (ids.length) await api("PUT", `archives/${id}/links`, { kind: "item", refId: itemId, objectiveIds: ids });
  };

  const detail = await api<{ items?: { id: string; kind: string; title: string }[] }>("GET", `archives/${id}`);
  const existing = new Map((detail.items ?? []).map((i) => [`${i.kind}:${key(i.title)}`, i.id]));

  for (const g of b.guides) {
    if (existing.has(`guide:${key(g.title)}`)) {
      result.skipped.push(`Guide "${g.title}" already exists`);
      continue;
    }
    step(`Saving guide "${g.title}"`);
    const it = await api<{ id: string }>("POST", `archives/${id}/items`, { kind: "guide", title: g.title, summary: g.summary, markdown: g.markdown, source: "ai" });
    existing.set(`guide:${key(g.title)}`, it.id);
    result.created.guides++;
    await link(it.id, `Guide "${g.title}"`, g.objectiveCodes);
  }

  for (const d of b.decks) {
    const had = existing.get(`deck:${key(d.title)}`);
    step(`Saving deck "${d.title}"`);
    if (had) {
      const cur = await api<{ front: string }[] | { cards: { front: string }[] }>("GET", `items/${had}/cards`);
      const fronts = new Set((Array.isArray(cur) ? cur : cur.cards).map((c) => key(c.front)));
      const fresh = d.cards.filter((c) => !fronts.has(key(c.front)));
      if (fresh.length) {
        await api("POST", `items/${had}/cards`, { cards: fresh, source: "ai" });
        result.created.cards += fresh.length;
      }
      if (fresh.length < d.cards.length) result.skipped.push(`${d.cards.length - fresh.length} cards already in "${d.title}"`);
      continue;
    }
    const it = await api<{ id: string }>("POST", `archives/${id}/items`, { kind: "deck", title: d.title, summary: d.summary, cards: d.cards, source: "ai" });
    existing.set(`deck:${key(d.title)}`, it.id);
    result.created.decks++;
    result.created.cards += d.cards.length;
    await link(it.id, `Deck "${d.title}"`, d.objectiveCodes);
  }

  for (const q of b.quizzes) {
    let qid = existing.get(`quiz:${key(q.title)}`);
    step(`Saving quiz "${q.title}"`);
    const stems = new Set<string>();
    if (qid) {
      const cur = await api<{ questions: { stem: string }[] }>("GET", `quizzes/${qid}/questions`);
      cur.questions.forEach((x) => stems.add(key(x.stem)));
    } else {
      const it = await api<{ id: string }>("POST", `archives/${id}/items`, { kind: "quiz", title: q.title, summary: q.summary, source: "ai" });
      qid = it.id;
      existing.set(`quiz:${key(q.title)}`, qid);
      result.created.quizzes++;
    }
    const fresh = q.questions.filter((x) => !stems.has(key(x.stem)));
    if (fresh.length < q.questions.length) result.skipped.push(`${q.questions.length - fresh.length} questions already in "${q.title}"`);
    const body = (x: BundleQuestion, n: number) => {
      const oid = x.objectiveCode ? resolve(`Quiz "${q.title}" question ${n}`, [x.objectiveCode])[0] : undefined;
      return { type: x.type, stem: x.stem, payload: x.payload, key: x.key, explanation: x.explanation, difficulty: x.difficulty, objectiveId: oid, source: "ai" };
    };
    for (let i = 0; i < fresh.length; i += 100) {
      await api("POST", `quizzes/${qid}/questions/bulk`, { questions: fresh.slice(i, i + 100).map((x, j) => body(x, i + j + 1)) });
      result.created.questions += Math.min(100, fresh.length - i);
    }
  }

  if (b.roadmap) {
    step("Drafting the roadmap");
    const r = await api<{ warnings?: string[] }>("POST", `archives/${id}/roadmap/outline`, { outline: b.roadmap, mode: "append", source: "ai" });
    result.created.roadmap = true;
    result.warnings.push(...(r.warnings ?? []));
  }
  return result;
}
