import { createHash } from "node:crypto";

/** The text Ultimyr keeps is the body of a note. The vault copy also carries Obsidian properties and a title line (the prefix). */
export const sha = (s: string) => createHash("sha256").update(s).digest("hex");

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n/;

export function splitFile(text: string): { prefix: string; body: string } {
  let rest = text;
  let prefix = "";
  const fm = FRONTMATTER.exec(rest);
  if (fm) {
    prefix += fm[0];
    rest = rest.slice(fm[0].length);
    const title = /^\s*# [^\n]*\n/.exec(rest);
    if (title) {
      prefix += title[0];
      rest = rest.slice(title[0].length);
      const source = /^Source: [^\n]*\n/.exec(rest);
      if (source) {
        prefix += source[0];
        rest = rest.slice(source[0].length);
      }
    }
  }
  return { prefix, body: rest.replace(/^(\s*\n)+/, "") };
}

export function composeFile(prefix: string, body: string): string {
  return prefix ? `${prefix}\n${body}` : body;
}
