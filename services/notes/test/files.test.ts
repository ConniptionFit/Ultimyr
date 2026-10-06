import { describe, expect, it } from "vitest";
import { composeFile, splitFile } from "../src/files.js";
import { stepHeader } from "../src/plan.js";

describe("vault file format", () => {
  const input = { archiveTitle: "A", slug: "a", stages: [] };
  const step = { id: "s1", title: "Intro", url: "https://example.com/x", children: [] };

  it("splits properties and title off the body, and puts them back", () => {
    const header = stepHeader(input, "Week 1", step);
    const file = header + "## Summary\nMine.\n";
    const { prefix, body } = splitFile(file);
    expect(body).toBe("## Summary\nMine.\n");
    expect(prefix).toContain("ultimyr_step: s1");
    expect(composeFile(prefix, body)).toBe(file);
  });

  it("leaves a plain note without properties alone", () => {
    expect(splitFile("# My heading\ntext\n")).toEqual({ prefix: "", body: "# My heading\ntext\n" });
    expect(composeFile("", "text")).toBe("text");
  });
});
