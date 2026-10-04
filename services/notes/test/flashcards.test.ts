import { describe, expect, it } from "vitest";
import { parseFlashcards } from "../src/flashcards.js";

describe("parseFlashcards", () => {
  it("reads Question :: Answer lines under ## Flashcards only", () => {
    const md = `---
x: 1
---
## Summary
Not a card :: ignore me

## Flashcards
<!-- One per line: Question :: Answer -->
What is X? :: Y
- Bullet form? :: Also fine
a line without the marker
What is X? :: duplicate

## Related
Later :: ignored
`;
    expect(parseFlashcards(md)).toEqual({
      cards: [
        { front: "What is X?", back: "Y" },
        { front: "Bullet form?", back: "Also fine" },
      ],
      skipped: 1,
    });
  });
  it("needs both sides and caps the count", () => {
    expect(parseFlashcards("## Flashcards\n:: only answer\nonly question ::\n").cards).toEqual([]);
    const many = "## Flashcards\n" + Array.from({ length: 5 }, (_, i) => `q${i} :: a`).join("\n");
    expect(parseFlashcards(many, 3)).toMatchObject({ skipped: 2 });
  });
  it("finds nothing without the section", () => expect(parseFlashcards("# Title\nq :: a")).toEqual({ cards: [], skipped: 0 }));
});
