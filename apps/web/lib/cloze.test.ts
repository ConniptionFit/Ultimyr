import { describe, expect, it } from "vitest";
import { clozeSides, isCloze } from "./cloze";

describe("cloze cards", () => {
  it("leaves ordinary cards alone", () => {
    expect(isCloze("What is 2+2?")).toBe(false);
    expect(clozeSides("Q", "A")).toEqual({ front: "Q", back: "A" });
  });
  it("hides every deletion on the front and shows them on the back", () => {
    expect(clozeSides("{{c1::TCP}} uses port {{c2::443::number}} for TLS", "")).toEqual({
      front: "**[...]** uses port **[number]** for TLS",
      back: "**TCP** uses port **443** for TLS",
    });
  });
  it("keeps the extra text after the filled-in sentence", () => {
    expect(clozeSides("The {{c1::SYN}} flag", "Starts the handshake").back).toBe("The **SYN** flag\n\nStarts the handshake");
  });
  it("can be called repeatedly (no stale regex state)", () => {
    expect(isCloze("{{c1::a}}")).toBe(true);
    expect(isCloze("{{c1::a}}")).toBe(true);
  });
});
