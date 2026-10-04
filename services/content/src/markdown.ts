export interface Section {
  ord: number;
  anchor: string;
  heading: string;
  body: string;
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "section";

/** Split Markdown into sections at headings (levels 1 to 3), ignoring `#` lines inside code fences. */
export function splitSections(md: string): Section[] {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out: { heading: string; body: string[] }[] = [];
  let cur: { heading: string; body: string[] } = { heading: "Introduction", body: [] };
  let fence: string | null = null;
  for (const line of lines) {
    const f = /^(\s*)(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (!fence) fence = f[2]![0]!;
      else if (f[2]![0] === fence) fence = null;
    }
    const h = !fence ? /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(line) : null;
    if (h) {
      out.push(cur);
      cur = { heading: h[2]!, body: [] };
    } else cur.body.push(line);
  }
  out.push(cur);
  const seen = new Map<string, number>();
  const sections: Section[] = [];
  for (const s of out) {
    const body = s.body.join("\n").trim();
    if (s.heading === "Introduction" && !body && sections.length === 0 && out.length > 1) continue;
    let a = slug(s.heading);
    const n = seen.get(a) ?? 0;
    seen.set(a, n + 1);
    if (n) a = `${a}-${n + 1}`;
    sections.push({ ord: sections.length, anchor: a, heading: s.heading, body });
  }
  return sections;
}

/** Quote one CSV field. */
export const csvField = (v: string) => (/[",\n\r\t]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** Parse CSV (comma or tab separated) with quoted fields, as exported by Anki and spreadsheets. */
export function parseCsv(text: string): string[][] {
  const delim = text.split("\n", 1)[0]!.includes("\t") ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === delim) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((x) => x !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x !== "")) rows.push(row);
  return rows;
}
