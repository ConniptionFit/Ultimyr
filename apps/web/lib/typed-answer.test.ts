import { describe, expect, it } from "vitest";
import { checkTyped, expectedAnswer, normalizeAnswer } from "./typed-answer";

describe("typed answers", () => {
  it("ignores case, punctuation and Markdown", () => {
    expect(normalizeAnswer("**The  Answer!**")).toBe("the answer");
    expect(checkTyped("the answer", "The Answer.")).toBe("match");
  });
  it("forgives a small typo in a longer answer but not a short one", () => {
    expect(checkTyped("virtual privte cloud", "Virtual private cloud")).toBe("close");
    expect(checkTyped("cat", "car")).toBe("different");
  });
  it("reports empty and different", () => {
    expect(checkTyped("  ", "x")).toBe("empty");
    expect(checkTyped("S3", "EBS volume")).toBe("different");
  });
  it("compares against the hidden words of a cloze card", () => {
    expect(expectedAnswer("The {{c1::hypervisor}} runs {{c2::VMs::guests}}", "extra")).toBe("hypervisor VMs");
    expect(expectedAnswer("plain front", "the back")).toBe("the back");
  });
});
