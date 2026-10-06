/**
 * Markdown formatting for the notes editor. Every function takes the text and the selection and returns the new text and
 * selection, so the toolbar is plain text editing that Obsidian reads as-is. Nothing here touches the DOM.
 *
 * Underline has no Markdown syntax, so it is written as <u>…</u>, which Obsidian renders.
 */
export interface Edit {
  text: string;
  start: number;
  end: number;
}

export type InlineMark = "bold" | "italic" | "underline" | "strike" | "code";
export type ListKind = "bullet" | "number" | "task";

const MARKS: Record<InlineMark, { open: string; close: string; sample: string }> = {
  bold: { open: "**", close: "**", sample: "bold text" },
  italic: { open: "_", close: "_", sample: "italic text" },
  underline: { open: "<u>", close: "</u>", sample: "underlined text" },
  strike: { open: "~~", close: "~~", sample: "struck text" },
  code: { open: "`", close: "`", sample: "code" },
};

/** Wraps the selection in the mark, or removes the mark if the selection is already wrapped in it. */
export function toggleInline(text: string, start: number, end: number, mark: InlineMark): Edit {
  const { open, close, sample } = MARKS[mark];
  const sel = text.slice(start, end);
  // Wrapped just outside the selection: take the marks off.
  if (start >= open.length && text.slice(start - open.length, start) === open && text.slice(end, end + close.length) === close) {
    return { text: text.slice(0, start - open.length) + sel + text.slice(end + close.length), start: start - open.length, end: end - open.length };
  }
  // The selection includes its own marks: take them off.
  if (sel.length >= open.length + close.length && sel.startsWith(open) && sel.endsWith(close)) {
    const inner = sel.slice(open.length, sel.length - close.length);
    return { text: text.slice(0, start) + inner + text.slice(end), start, end: start + inner.length };
  }
  const body = sel || sample;
  const next = text.slice(0, start) + open + body + close + text.slice(end);
  return { text: next, start: start + open.length, end: start + open.length + body.length };
}

/** The start and end offsets of the lines the selection touches (end excludes the newline). */
function lineRange(text: string, start: number, end: number): [number, number] {
  const from = text.lastIndexOf("\n", start - 1) + 1;
  // A selection that ends right after a newline does not include the next line.
  const probe = end > start && text[end - 1] === "\n" ? end - 1 : end;
  const nl = text.indexOf("\n", probe);
  return [from, nl === -1 ? text.length : nl];
}

const LIST_RE = /^(\s*)(?:[-*+] \[[ xX]\] |[-*+] |\d+[.)] )/;
const HEADING_RE = /^#{1,6} /;
const QUOTE_RE = /^(\s*)> ?/;

/** Rewrites the lines the selection touches and keeps the selection over them. */
function mapLines(text: string, start: number, end: number, fn: (lines: string[]) => string[]): Edit {
  const [from, to] = lineRange(text, start, end);
  const next = fn(text.slice(from, to).split("\n")).join("\n");
  return { text: text.slice(0, from) + next + text.slice(to), start: from, end: from + next.length };
}

/** Sets a heading level on the selected lines (1 to 3), or removes it when they already have that level. */
export function setHeading(text: string, start: number, end: number, level: 0 | 1 | 2 | 3): Edit {
  const prefix = "#".repeat(level) + " ";
  return mapLines(text, start, end, (lines) => {
    const nonEmpty = lines.filter((l) => l.trim());
    const same = level > 0 && nonEmpty.length > 0 && nonEmpty.every((l) => l.startsWith(prefix));
    return lines.map((l) => {
      if (!l.trim()) return l;
      const bare = l.replace(HEADING_RE, "");
      return level === 0 || same ? bare : prefix + bare;
    });
  });
}

/** Bulleted, numbered or task list on the selected lines; pressing it again turns the list off. */
export function toggleList(text: string, start: number, end: number, kind: ListKind): Edit {
  return mapLines(text, start, end, (lines) => {
    const has = (l: string) => {
      const m = LIST_RE.exec(l);
      if (!m) return false;
      const marker = l.slice((m[1] ?? "").length, m[0].length);
      return kind === "task" ? /^[-*+] \[[ xX]\] $/.test(marker) : kind === "number" ? /^\d+[.)] $/.test(marker) : /^[-*+] $/.test(marker);
    };
    const nonEmpty = lines.filter((l) => l.trim());
    const off = nonEmpty.length > 0 && nonEmpty.every(has);
    const counters = new Map<number, number>();
    return lines.map((l) => {
      if (!l.trim()) return l;
      const indent = /^\s*/.exec(l)![0];
      const bare = l.replace(LIST_RE, "$1").replace(HEADING_RE, "");
      if (off) return bare;
      if (kind === "bullet") return indent + "- " + bare.slice(indent.length);
      if (kind === "task") return indent + "- [ ] " + bare.slice(indent.length);
      for (const k of [...counters.keys()]) if (k > indent.length) counters.delete(k);
      const n = (counters.get(indent.length) ?? 0) + 1;
      counters.set(indent.length, n);
      return `${indent}${n}. ${bare.slice(indent.length)}`;
    });
  });
}

/** Block quote on the selected lines; pressing it again removes it. */
export function toggleQuote(text: string, start: number, end: number): Edit {
  return mapLines(text, start, end, (lines) => {
    const nonEmpty = lines.filter((l) => l.trim());
    const off = nonEmpty.length > 0 && nonEmpty.every((l) => /^> ?/.test(l));
    return lines.map((l) => (off ? l.replace(/^> ?/, "") : "> " + l));
  });
}

/** Nests the selected lines one level deeper (a tab, which Markdown and Obsidian both read as one list level). */
export function indent(text: string, start: number, end: number): Edit {
  return mapLines(text, start, end, (lines) => lines.map((l) => (l.trim() ? "\t" + l : l)));
}

/** Moves the selected lines one level out. */
export function outdent(text: string, start: number, end: number): Edit {
  return mapLines(text, start, end, (lines) => lines.map((l) => l.replace(/^(\t| {1,4})/, "")));
}

/** Fenced code block around the selection; pressing it again removes the fences. */
export function toggleCodeBlock(text: string, start: number, end: number): Edit {
  const [from, to] = lineRange(text, start, end);
  const block = text.slice(from, to);
  const lines = block.split("\n");
  if (lines.length >= 2 && /^```/.test(lines[0] ?? "") && (lines[lines.length - 1] ?? "").trim() === "```") {
    const inner = lines.slice(1, -1).join("\n");
    return { text: text.slice(0, from) + inner + text.slice(to), start: from, end: from + inner.length };
  }
  const body = block || "code";
  const next = "```\n" + body + "\n```";
  return { text: text.slice(0, from) + next + text.slice(to), start: from + 4, end: from + 4 + body.length };
}

/** Link around the selection, with the address ready to type. */
export function insertLink(text: string, start: number, end: number): Edit {
  const label = text.slice(start, end) || "link text";
  const url = /^https?:\/\/\S+$/.test(label) ? label : "https://";
  const asUrl = url === label;
  const shown = asUrl ? "link text" : label;
  const next = text.slice(0, start) + `[${shown}](${url})` + text.slice(end);
  // A pasted address is already the target, so select the label to type over; otherwise select the address.
  if (asUrl) return { text: next, start: start + 1, end: start + 1 + shown.length };
  const urlStart = start + shown.length + 3;
  return { text: next, start: urlStart, end: urlStart + url.length };
}

/** A horizontal rule on its own line after the cursor line. */
export function insertRule(text: string, start: number, end: number): Edit {
  const [, to] = lineRange(text, start, end);
  const insert = (to > 0 ? "\n" : "") + "\n---\n";
  const next = text.slice(0, to) + insert + text.slice(to);
  const at = to + insert.length;
  return { text: next, start: at, end: at };
}

/** A small table to fill in, on its own lines. */
export function insertTable(text: string, start: number, end: number): Edit {
  const [, to] = lineRange(text, start, end);
  const head = "| Column 1 | Column 2 |\n| --- | --- |\n| ";
  const insert = (to > 0 ? "\n\n" : "") + head + " |  |\n";
  const next = text.slice(0, to) + insert + text.slice(to);
  const at = to + insert.length - " |  |\n".length;
  return { text: next, start: at, end: at };
}

/** Removes inline marks, links, headings, quotes and list markers from the selection (or the current line). */
export function clearFormatting(text: string, start: number, end: number): Edit {
  const [from, to] = start === end ? lineRange(text, start, end) : [start, end];
  const clean = text
    .slice(from, to)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<\/?u>/g, "")
    .replace(/(\*\*|~~|`)(.+?)\1/g, "$2")
    .replace(/(^|[^\w])_(.+?)_(?!\w)/g, "$1$2")
    .replace(/^(\s*)(?:#{1,6} |> ?|[-*+] \[[ xX]\] |[-*+] |\d+[.)] )/gm, "$1");
  return { text: text.slice(0, from) + clean + text.slice(to), start: from, end: from + clean.length };
}

/** Enter at the end of a list item starts the next item; Enter on an empty item ends the list. Null means "do nothing special". */
export function continueList(text: string, pos: number): Edit | null {
  const from = text.lastIndexOf("\n", pos - 1) + 1;
  const nl = text.indexOf("\n", pos);
  const to = nl === -1 ? text.length : nl;
  if (pos !== to) return null;
  const line = text.slice(from, to);
  const m = /^(\s*)([-*+] \[[ xX]\] |[-*+] |(\d+)([.)]) |> )/.exec(line);
  if (!m) return null;
  if (line.slice(m[0].length).trim() === "") {
    // Empty item: remove the marker and leave a blank line.
    return { text: text.slice(0, from) + text.slice(to), start: from, end: from };
  }
  let marker = m[2] ?? "";
  if (m[3] !== undefined) marker = `${Number(m[3]) + 1}${m[4]} `;
  else if (/\[[ xX]\]/.test(marker)) marker = marker.replace(/\[[xX]\]/, "[ ]");
  const insert = "\n" + m[1] + marker;
  return { text: text.slice(0, pos) + insert + text.slice(pos), start: pos + insert.length, end: pos + insert.length };
}
