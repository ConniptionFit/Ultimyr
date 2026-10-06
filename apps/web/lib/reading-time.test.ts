import { describe, expect, it } from "vitest";
import { readingMinutes } from "./reading-time";

describe("readingMinutes", () => {
  it("is at least one minute, even for nothing", () => {
    expect(readingMinutes("")).toBe(1);
    expect(readingMinutes("a few words")).toBe(1);
  });
  it("counts words, not markup or link addresses", () => {
    const body = "## Heading\n\n" + "word ".repeat(400) + "\n\n[a link](https://example.com/a/very/long/path) ![img](x.png)";
    expect(readingMinutes(body)).toBe(2);
  });
  it("counts a code block as a single word", () => {
    expect(readingMinutes("```\n" + "x ".repeat(1000) + "\n```")).toBe(1);
  });
});
