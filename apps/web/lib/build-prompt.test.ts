import { DEPTH } from "@ultimyr/coverage";
import { describe, expect, it } from "vitest";
import { DEPTH_TARGETS, checkBundles, parseBundle } from "@ultimyr/bundle";
import { bundlePrompt, continuePrompt, gapPrompt, skillMarkdown, startPrompt } from "./build-prompt";

describe("build prompts", () => {
  it("names the certification, depth and the tools to use", () => {
    const p = startPrompt("  CompTIA A+ 220-1201 ", "deep");
    expect(p).toContain('"CompTIA A+ 220-1201"');
    expect(p).toContain("Depth: deep");
    for (const tool of ["create_archive", "set_objectives", "import_outline", "get_build_queue", "get_coverage"]) expect(p).toContain(tool);
    expect(p).toContain("Do the research yourself");
    expect(p).toContain("Never save a link you did not open");
    expect(p).toContain("never copies");
  });
  it("falls back to a placeholder and never uses em dashes", () => {
    expect(startPrompt("", "quick")).toContain("<certification name>");
    expect(startPrompt("x", "standard") + continuePrompt("A", "id1", "standard")).not.toMatch(/—/);
  });
  it("carries the archive id when continuing", () => {
    expect(continuePrompt("A+", "abc", "quick")).toContain("id abc");
  });
  it("gives a chat without a connector the format, an example and the stop rules", () => {
    const p = bundlePrompt("Security+", "quick");
    expect(p).toContain('"Security+"');
    expect(p).toContain("=== end ===");
    expect(p).toContain("ultimyr-bundle v1");
    expect(p).toContain("come from sources you opened this session");
    expect(p).toContain("at least 5 flashcards and 3 questions");
    expect(p).not.toMatch(/\u2014/);
  });
  it("runs the same fixed passes and standards in the prompt and the skill", () => {
    const p = bundlePrompt("Security+", "standard");
    const k = skillMarkdown();
    for (const text of [p, k]) {
      for (const bit of ["R. Research", "A. Objectives and roadmap", "B. One domain at a time", "C. Gap fill", "## Why it matters", "Never reproduce real exam questions", "=== end ==="]) expect(text).toContain(bit);
      expect(text).not.toMatch(/\u2014/);
    }
    expect(k.startsWith("---\nname: ultimyr-course-builder")).toBe(true);
  });
  it("turns a coverage check into a gap prompt", () => {
    const b = parseBundle("=== objectives ===\n## 1.0 D (100%)\n- 1.1 A\n- 1.2 B\n=== end ===\n=== guide: G ===\nobjectives: 1.1\n\n# G\n=== end ===");
    const p = gapPrompt(checkBundles([b], "quick"));
    expect(p).toContain("0 of 2 objectives are complete");
    expect(p).toContain("- 1.2: a guide, 5 more flashcards, 3 more questions");
  });
  it("keeps the bundle depth targets equal to the coverage depths", () => {
    expect(DEPTH_TARGETS).toEqual(DEPTH);
  });
});
