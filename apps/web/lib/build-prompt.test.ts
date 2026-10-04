import { describe, expect, it } from "vitest";
import { continuePrompt, startPrompt } from "./build-prompt";

describe("build prompts", () => {
  it("names the certification, depth and the tools to use", () => {
    const p = startPrompt("  CompTIA A+ 220-1201 ", "deep");
    expect(p).toContain('"CompTIA A+ 220-1201"');
    expect(p).toContain("Depth: deep");
    for (const tool of ["create_archive", "set_objectives", "import_outline", "get_build_queue", "get_coverage"]) expect(p).toContain(tool);
    expect(p).toContain("Never guess");
  });
  it("falls back to a placeholder and never uses em dashes", () => {
    expect(startPrompt("", "quick")).toContain("<certification name>");
    expect(startPrompt("x", "standard") + continuePrompt("A", "id1", "standard")).not.toMatch(/—/);
  });
  it("carries the archive id when continuing", () => {
    expect(continuePrompt("A+", "abc", "quick")).toContain("id abc");
  });
});
