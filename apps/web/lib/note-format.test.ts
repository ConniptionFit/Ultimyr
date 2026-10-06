import { describe, expect, it } from "vitest";
import { clearFormatting, continueList, indent, insertLink, insertRule, insertTable, outdent, setHeading, toggleCodeBlock, toggleInline, toggleList, toggleQuote } from "./note-format";

const run = (text: string, sel: string, fn: (t: string, s: number, e: number) => { text: string; start: number; end: number }) => {
  const s = text.indexOf(sel);
  return fn(text, s, s + sel.length);
};

describe("inline marks", () => {
  it("wraps and unwraps bold", () => {
    const a = run("a word here", "word", (t, s, e) => toggleInline(t, s, e, "bold"));
    expect(a.text).toBe("a **word** here");
    expect(a.text.slice(a.start, a.end)).toBe("word");
    expect(toggleInline(a.text, a.start, a.end, "bold").text).toBe("a word here");
  });
  it("unwraps when the selection includes the marks", () => {
    const t = "a **word** here";
    expect(toggleInline(t, 2, 10, "bold").text).toBe("a word here");
  });
  it("inserts a placeholder with nothing selected and selects it", () => {
    const r = toggleInline("", 0, 0, "italic");
    expect(r.text).toBe("_italic text_");
    expect(r.text.slice(r.start, r.end)).toBe("italic text");
  });
  it("writes underline as <u>, strike as ~~ and code as backticks", () => {
    expect(run("x y z", "y", (t, s, e) => toggleInline(t, s, e, "underline")).text).toBe("x <u>y</u> z");
    expect(run("x y z", "y", (t, s, e) => toggleInline(t, s, e, "strike")).text).toBe("x ~~y~~ z");
    expect(run("x y z", "y", (t, s, e) => toggleInline(t, s, e, "code")).text).toBe("x `y` z");
  });
  it("does not read bold as italic", () => {
    expect(run("**x**", "x", (t, s, e) => toggleInline(t, s, e, "italic")).text).toBe("**_x_**");
  });
});

describe("line formats", () => {
  it("sets, switches and removes headings", () => {
    expect(setHeading("Title", 0, 0, 2).text).toBe("## Title");
    expect(setHeading("## Title", 0, 0, 3).text).toBe("### Title");
    expect(setHeading("## Title", 0, 0, 2).text).toBe("Title");
    expect(setHeading("## Title", 0, 0, 0).text).toBe("Title");
  });
  it("makes and removes bullet lists over several lines", () => {
    const r = toggleList("a\n\nb\nc", 0, 4, "bullet");
    expect(r.text).toBe("- a\n\n- b\nc");
    expect(toggleList("- a\n- b", 0, 7, "bullet").text).toBe("a\nb");
  });
  it("numbers lines and restarts per nesting level", () => {
    expect(toggleList("a\nb\nc", 0, 5, "number").text).toBe("1. a\n2. b\n3. c");
    expect(toggleList("1. a\n2. b", 0, 9, "number").text).toBe("a\nb");
  });
  it("switches between list kinds without stacking markers", () => {
    expect(toggleList("- a\n- b", 0, 7, "number").text).toBe("1. a\n2. b");
    expect(toggleList("- a", 0, 3, "task").text).toBe("- [ ] a");
    expect(toggleList("- [ ] a", 0, 7, "task").text).toBe("a");
  });
  it("only touches the lines the selection reaches", () => {
    expect(toggleList("a\nb\nc", 2, 3, "bullet").text).toBe("a\n- b\nc");
    expect(toggleList("a\nb\n", 0, 2, "bullet").text).toBe("- a\nb\n");
  });
  it("quotes and unquotes", () => {
    expect(toggleQuote("a\nb", 0, 3).text).toBe("> a\n> b");
    expect(toggleQuote("> a\n> b", 0, 7).text).toBe("a\nb");
  });
  it("indents and outdents", () => {
    expect(indent("- a\n- b", 0, 7).text).toBe("\t- a\n\t- b");
    expect(outdent("\t- a\n  - b", 0, 10).text).toBe("- a\n- b");
  });
});

describe("blocks and inserts", () => {
  it("fences and unfences code", () => {
    const r = toggleCodeBlock("x = 1", 0, 5);
    expect(r.text).toBe("```\nx = 1\n```");
    expect(toggleCodeBlock(r.text, 0, r.text.length).text).toBe("x = 1");
  });
  it("makes a link and selects the address, or the label for a pasted address", () => {
    const a = insertLink("see docs", 4, 8);
    expect(a.text).toBe("see [docs](https://)");
    expect(a.text.slice(a.start, a.end)).toBe("https://");
    const b = insertLink("https://a.dev", 0, 13);
    expect(b.text).toBe("[link text](https://a.dev)");
  });
  it("inserts a rule and a table on their own lines", () => {
    expect(insertRule("abc", 1, 1).text).toBe("abc\n\n---\n");
    expect(insertTable("abc", 0, 0).text).toContain("abc\n\n| Column 1 | Column 2 |\n| --- | --- |\n|");
  });
  it("clears formatting", () => {
    expect(clearFormatting("## **a** <u>b</u> [c](https://x.dev) `d`", 0, 0).text).toBe("a b c d");
    expect(clearFormatting("- [ ] _a_", 0, 0).text).toBe("a");
  });
});

describe("Enter in lists", () => {
  it("continues bullets, numbers and tasks", () => {
    expect(continueList("- a", 3)?.text).toBe("- a\n- ");
    expect(continueList("2. a", 4)?.text).toBe("2. a\n3. ");
    expect(continueList("- [x] a", 7)?.text).toBe("- [x] a\n- [ ] ");
  });
  it("ends the list on an empty item", () => {
    expect(continueList("- a\n- ", 6)?.text).toBe("- a\n");
  });
  it("leaves other lines and mid-line cursors alone", () => {
    expect(continueList("plain", 5)).toBeNull();
    expect(continueList("- abc", 3)).toBeNull();
  });
});
