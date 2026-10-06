import { describe, expect, it } from "vitest";
import { jumpScore, rankJump, type JumpEntry } from "./quick-jump";

const e = (label: string, extra: Partial<JumpEntry> = {}): JumpEntry => ({ id: label, label, href: `/${label}`, ...extra });

describe("quick jump ranking", () => {
  it("returns everything in the given order for an empty query", () => {
    const list = [e("b"), e("a")];
    expect(rankJump(list, "  ").map((x) => x.id)).toEqual(["b", "a"]);
  });

  it("prefers a label prefix over a word prefix over a substring", () => {
    const list = [e("Practice exam countdown"), e("Exam day"), e("Reexamine")];
    expect(rankJump(list, "exam").map((x) => x.id)).toEqual(["Exam day", "Practice exam countdown", "Reexamine"]);
  });

  it("matches hints and keywords below label matches", () => {
    const list = [e("Credentials", { keywords: "badge voucher" }), e("Voucher codes")];
    expect(rankJump(list, "voucher").map((x) => x.id)).toEqual(["Voucher codes", "Credentials"]);
  });

  it("accepts letters in order and drops non-matches", () => {
    expect(jumpScore(e("Weak-area drills"), "wkd")).toBe(10);
    expect(jumpScore(e("Progress"), "zzz")).toBe(0);
  });

  it("caps the list", () => {
    const list = Array.from({ length: 20 }, (_, i) => e(`Course ${i}`));
    expect(rankJump(list, "course", 5)).toHaveLength(5);
  });
});
