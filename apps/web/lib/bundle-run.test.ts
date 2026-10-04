import { FORMAT_EXAMPLE, parseBundle } from "@ultimyr/bundle";
import { describe, expect, it } from "vitest";
import { runBundle, type Api } from "./bundle-run";

const O1 = "00000000-0000-7000-8000-000000000011";
const tree = { objectives: [{ id: "d1", code: "1.0", children: [{ id: O1, code: "1.1" }, { id: "o12", code: "1.2" }] }, { id: "d2", code: "2.0", children: [{ id: "o21", code: "2.1" }] }] };

function fake(state: { items?: any[]; cards?: any[]; questions?: any[] } = {}) {
  const calls: { method: string; path: string; body: any }[] = [];
  let n = 0;
  const api = (async (method: string, path: string, body?: unknown) => {
    calls.push({ method, path, body });
    if (method === "POST" && path === "archives") return { id: "arch" };
    if (path.endsWith("/objectives/import")) return { warnings: ["w1"] };
    if (method === "GET" && path === "archives/arch/objectives") return tree;
    if (method === "GET" && path === "archives/arch") return { items: state.items ?? [] };
    if (method === "GET" && path.endsWith("/cards")) return state.cards ?? [];
    if (method === "GET" && path.endsWith("/questions")) return { questions: state.questions ?? [] };
    if (path.endsWith("/items")) return { id: `item${++n}` };
    if (path.endsWith("/roadmap/outline")) return { warnings: ["rw"] };
    return {};
  }) as Api;
  return { api, calls };
}

describe("runBundle", () => {
  it("creates the archive, then objectives, guides, decks, quizzes and the roadmap last, all as drafts with links", async () => {
    const { api, calls } = fake();
    const steps: string[] = [];
    const r = await runBundle(api, parseBundle(FORMAT_EXAMPLE), {}, (s) => steps.push(s));
    expect(calls[0]).toMatchObject({ method: "POST", path: "archives", body: { title: "Example Cert", vendor: "Example Vendor" } });
    expect(calls.at(-1)!.path).toBe("archives/arch/roadmap/outline");
    expect(calls.at(-1)!.body).toMatchObject({ mode: "append", source: "ai" });
    const created = calls.filter((c) => c.path === "archives/arch/items");
    expect(created.map((c) => [c.body.kind, c.body.source])).toEqual([["guide", "ai"], ["deck", "ai"], ["quiz", "ai"]]);
    expect(calls.filter((c) => c.path === "archives/arch/links").map((c) => c.body)).toEqual([
      { kind: "item", refId: "item1", objectiveIds: [O1, "o12"] },
      { kind: "item", refId: "item2", objectiveIds: [O1] },
    ]);
    const bulk = calls.find((c) => c.path === "quizzes/item3/questions/bulk")!;
    expect(bulk.body.questions).toHaveLength(3);
    expect(bulk.body.questions[0]).toMatchObject({ type: "mcq", objectiveId: O1, source: "ai", key: { correct: "b" } });
    expect(r.created).toEqual({ guides: 1, decks: 1, cards: 2, quizzes: 1, questions: 3, roadmap: true, objectives: true });
    expect(r.warnings).toEqual(["w1", "rw"]);
    expect(steps[0]).toMatch(/Creating the archive/);
  });

  it("does not repeat work that already exists", async () => {
    const { api, calls } = fake({
      items: [{ id: "g", kind: "guide", title: "ports and protocols" }, { id: "d", kind: "deck", title: "Networking flashcards" }, { id: "q", kind: "quiz", title: "Networking quiz" }],
      cards: [{ front: "What port does HTTPS use?" }],
      questions: [{ stem: "Which port does HTTPS use by default?" }],
    });
    const r = await runBundle(api, parseBundle(FORMAT_EXAMPLE), { archiveId: "arch" });
    expect(calls.some((c) => c.method === "POST" && c.path === "archives")).toBe(false);
    expect(calls.some((c) => c.path === "archives/arch/items")).toBe(false);
    expect(calls.find((c) => c.path === "items/d/cards" && c.method === "POST")!.body.cards).toEqual([{ front: "Which transport protocol is connectionless?", back: "UDP" }]);
    expect(calls.find((c) => c.path === "quizzes/q/questions/bulk")!.body.questions).toHaveLength(2);
    expect(r.skipped).toEqual(['Guide "Ports and protocols" already exists', '1 cards already in "Networking flashcards"', '1 questions already in "Networking quiz"']);
    expect(r.created).toMatchObject({ guides: 0, decks: 0, cards: 1, quizzes: 0, questions: 2 });
  });

  it("warns about unknown objective codes, needs an archive title, and splits big quizzes", async () => {
    const { api, calls } = fake();
    const b = parseBundle("=== guide: G ===\nobjectives: 9.9\n\ntext\n=== end ===");
    const r = await runBundle(api, b, { archiveId: "arch" });
    expect(r.warnings[0]).toMatch(/no objective 9\.9/);
    expect(calls.some((c) => c.path.endsWith("/links"))).toBe(false);
    await expect(runBundle(api, b, {})).rejects.toThrow(/no archive/);

    const many = Array.from({ length: 150 }, (_, i) => `Q mcq\nQuestion ${i}\na) x *\nb) y`).join("\n\n");
    const f = fake();
    await runBundle(f.api, parseBundle(`=== quiz: Big ===\n${many}\n=== end ===`), { archiveId: "arch" });
    expect(f.calls.filter((c) => c.path.endsWith("/bulk")).map((c) => c.body.questions.length)).toEqual([100, 50]);
  });

  it("reports which step failed by letting the error through", async () => {
    const { api } = fake();
    const failing: Api = async (m, p, b) => (p.endsWith("/roadmap/outline") ? Promise.reject(new Error("boom")) : api(m, p, b));
    await expect(runBundle(failing, parseBundle(FORMAT_EXAMPLE), {})).rejects.toThrow("boom");
  });
});
