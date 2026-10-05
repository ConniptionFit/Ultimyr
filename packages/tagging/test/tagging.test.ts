import { describe, expect, it } from "vitest";
import { ICON_COUNT, ICON_NAMES, LUCIDE_VERSION, MIN_AUTO_SCORE, VOCABULARY, bestIcon, contentTypesFor, hasIcon, iconInfo, inferTopics, normalizeTag, normalizeTags, searchIcons, suggestIcons, TAG_PATTERN } from "../src/index.js";
import { nodeFor } from "../src/nodes.js";

describe("icon catalog", () => {
  it("bundles the whole pinned Lucide set with nodes for every icon", () => {
    expect(LUCIDE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(ICON_COUNT).toBeGreaterThan(1500);
    for (const n of ICON_NAMES) expect(nodeFor(n), n).not.toBeNull();
    expect(hasIcon("bot")).toBe(true);
    expect(hasIcon("not-an-icon")).toBe(false);
    expect(hasIcon("__proto__")).toBe(false);
  });

  it("only curates icons that exist in the bundled set", () => {
    const missing: string[] = [];
    for (const ns of Object.values(VOCABULARY)) for (const [v, d] of Object.entries(ns)) for (const i of d.icons) if (!hasIcon(i)) missing.push(`${v}:${i}`);
    expect(missing).toEqual([]);
  });

  it("has well formed vocabulary values", () => {
    for (const [ns, defs] of Object.entries(VOCABULARY)) for (const v of Object.keys(defs)) expect(TAG_PATTERN.test(`${ns}:${v}`), `${ns}:${v}`).toBe(true);
  });
});

describe("tag normalization", () => {
  it("canonicalizes words, namespaces and synonyms", () => {
    expect(normalizeTag("AI")?.tag).toBe("topic:ai");
    expect(normalizeTag("Artificial Intelligence")?.tag).toBe("topic:ai");
    expect(normalizeTag("video")?.tag).toBe("content-type:video");
    expect(normalizeTag("type:Reading")?.tag).toBe("content-type:reading");
    expect(normalizeTag("subject: Networks")?.tag).toBe("topic:networking");
    expect(normalizeTag("vendor:Anthropic")?.tag).toBe("vendor:anthropic");
    expect(normalizeTag("Cloud Security")?.tag).toBe("topic:cloud-security");
  });
  it("rejects unusable input and dedupes lists", () => {
    expect(normalizeTag("")).toBeNull();
    expect(normalizeTag("!!!")).toBeNull();
    expect(normalizeTag(":")).toBeNull();
    expect(normalizeTags(["AI", "ai", "llm", "video", "", "x:y:z"])).toEqual(["topic:ai", "content-type:video", "x:y-z"]);
  });
});

describe("inference", () => {
  it("reads topics from text and ignores partial words", () => {
    expect(inferTopics("Introduction to large language models and prompting").map((t) => t.tag)).toEqual(expect.arrayContaining(["topic:ai", "topic:prompt-engineering"]));
    expect(inferTopics("Subnetting and DNS for the network+ exam").map((t) => t.tag)).toContain("topic:networking");
    expect(inferTopics("The captain said hello").length).toBe(0);
  });
  it("maps what the app stores to content types", () => {
    expect(contentTypesFor({ resourceKind: "video" })).toEqual(["content-type:video"]);
    expect(contentTypesFor({ resourceKind: "playlist" })).toEqual(["content-type:video"]);
    expect(contentTypesFor({ itemKind: "deck" })).toEqual(["content-type:flashcards"]);
    expect(contentTypesFor({ resourceKind: "other" })).toEqual([]);
  });
});

describe("icon suggestions", () => {
  it("puts a robot first for AI", () => {
    const s = suggestIcons(["topic:ai"]);
    expect(s[0]?.name).toBe("bot");
    expect(s[0]?.matched).toEqual(["topic:ai"]);
  });
  it("ranks icons that match more tags higher", () => {
    const one = suggestIcons(["topic:networking"]);
    const two = suggestIcons(["topic:networking", "topic:security"]);
    const score = (list: typeof one, n: string) => list.find((x) => x.name === n)?.score ?? 0;
    // An icon that suits both tags beats one that suits only one of them.
    const both = suggestIcons(["topic:networking", "topic:security"], { limit: 200 });
    const shared = both.find((x) => x.matched.length === 2);
    if (shared) expect(shared.score).toBeGreaterThan(score(one, shared.name));
    expect(two[0]?.score).toBeGreaterThan(0);
    expect(suggestIcons(["topic:networking"], { limit: 1 })[0]?.name).toBe("network");
  });
  it("counts inherited (lower weight) tags less", () => {
    const own = suggestIcons([{ tag: "topic:ai", weight: 1 }], { limit: 1 })[0]!;
    const inherited = suggestIcons([{ tag: "topic:ai", weight: 0.5 }], { limit: 1 })[0]!;
    expect(inherited.score).toBeCloseTo(own.score / 2, 1);
  });
  it("lets a topic outrank a content type", () => {
    expect(suggestIcons(["topic:ai", "content-type:video"], { limit: 1 })[0]?.name).toBe("bot");
  });
  it("only auto picks with enough evidence", () => {
    expect(bestIcon(["topic:ai"])?.name).toBe("bot");
    expect(bestIcon([{ tag: "topic:ai", weight: 0.4 }])).toBeNull();
    expect(bestIcon(["level:beginner"])).toBeNull();
    expect(bestIcon(["vendor:acme"])).toBeNull();
    expect(bestIcon([])).toBeNull();
    expect(MIN_AUTO_SCORE).toBeGreaterThan(0);
  });
  it("excludes icons and honours the limit", () => {
    expect(suggestIcons(["topic:ai"], { exclude: ["bot"], limit: 3 }).map((s) => s.name)).not.toContain("bot");
    expect(suggestIcons(["topic:ai"], { limit: 3 })).toHaveLength(3);
  });
  it("describes where each icon is suggested", () => {
    const info = iconInfo("bot")!;
    expect(info.tags.length).toBeGreaterThan(0);
    expect(info.suggestFor.map((s) => s.tag)).toContain("topic:ai");
    expect(iconInfo("nope")).toBeNull();
  });
  it("searches by name and by Lucide tag, and pages", () => {
    expect(searchIcons("robot").icons.map((i) => i.name)).toContain("bot");
    const page = searchIcons("", { limit: 10, offset: 10 });
    expect(page.total).toBe(ICON_COUNT);
    expect(page.icons).toHaveLength(10);
    expect(searchIcons("zzzzzz").total).toBe(0);
    expect(searchIcons("", { tag: "topic:ai", limit: 3 }).icons[0]?.name).toBe("bot");
  });
});
