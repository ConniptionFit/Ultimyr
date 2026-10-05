/** Turns a roadmap into the note files of the Ultimyr note standard v1 (docs/notes.md). Pure: no network, no clock. */

export interface PlanStep {
  id: string;
  title: string;
  url?: string | null;
  children: PlanStep[];
}
export interface PlanStage {
  title: string;
  steps: PlanStep[];
}
export interface PlanInput {
  archiveTitle: string;
  slug: string;
  stages: PlanStage[];
}
export interface PlannedNote {
  kind: "index" | "step";
  stepId?: string;
  path: string;
  title: string;
  content: string;
}

/** Plain, Obsidian-safe file names: no # ^ [ ] | \ / : ? and at most 80 characters. */
export function safeName(s: string, fallback = "Untitled"): string {
  const t = s.replace(/[#^[\]|\\/:?*"<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 80).trim();
  return t || fallback;
}

const num = (i: number) => String(i + 1).padStart(2, "0");
const yamlStr = (s: string) => JSON.stringify(s);
const withoutExt = (p: string) => p.replace(/\.md$/, "");

export const STEP_BODY = `## Summary

## Key points
- 

## Examples

## Questions
- 

## Flashcards
<!-- One per line: Question :: Answer -->

## Related
- 
`;

export function stepHeader(input: PlanInput, stage: string, s: PlanStep): string {
  const fm = [
    "---",
    "ultimyr: 1",
    "type: step",
    `archive: ${input.slug}`,
    `ultimyr_step: ${s.id}`,
    `stage: ${yamlStr(stage)}`,
    ...(s.url ? [`source: ${s.url}`] : []),
    "status: todo",
    `tags: [ultimyr, ${input.slug}]`,
    "---",
    "",
    `# ${s.title}`,
    "",
  ];
  return fm.join("\n") + (s.url ? `Source: ${s.url}\n\n` : "");
}

const stepNote = (input: PlanInput, stage: string, s: PlanStep) => stepHeader(input, stage, s) + STEP_BODY;

export const DEFAULT_ROOT = "Ultimyr";

/** The folder in the vault that holds everything Ultimyr writes: up to three plain folder names, no slashes at the ends. */
export function cleanRoot(raw: string | null | undefined): string {
  const parts = (raw ?? "")
    .split("/")
    .map((x) => safeName(x, ""))
    .filter(Boolean)
    .slice(0, 3);
  return parts.length ? parts.join("/") : DEFAULT_ROOT;
}

export function indexPath(slug: string, rootFolder = DEFAULT_ROOT): string {
  return `${cleanRoot(rootFolder)}/${slug}/00 Index.md`;
}

export function planNotes(input: PlanInput, rootFolder = DEFAULT_ROOT): PlannedNote[] {
  const root = `${cleanRoot(rootFolder)}/${input.slug}`;
  const out: PlannedNote[] = [];
  const stageLinks: string[] = [];

  const walk = (steps: PlanStep[], dir: string, stage: string, depth: number, links: string[]) => {
    steps.forEach((s, i) => {
      const name = `${num(i)} ${safeName(s.title)}`;
      const path = `${dir}/${name}.md`;
      out.push({ kind: "step", stepId: s.id, path, title: s.title, content: stepNote(input, stage, s) });
      links.push(`${"  ".repeat(depth)}- [[${withoutExt(path)}|${s.title.replace(/[[\]|]/g, "")}]]`);
      if (s.children.length) walk(s.children, `${dir}/${name}`, stage, depth + 1, links);
    });
  };

  input.stages.forEach((st, i) => {
    const dir = `${root}/${num(i)} ${safeName(st.title, "Stage")}`;
    const links: string[] = [];
    walk(st.steps, dir, st.title, 0, links);
    stageLinks.push(`## ${st.title}\n${links.join("\n") || "- (no steps yet)"}\n`);
  });

  const index = [
    "---",
    "ultimyr: 1",
    "type: index",
    `archive: ${input.slug}`,
    `tags: [ultimyr, ${input.slug}]`,
    "---",
    "",
    `# ${input.archiveTitle}`,
    "",
    "## Goal",
    "",
    "## Where I am",
    "",
    ...stageLinks,
    "## Concepts",
    "",
    "## Reviews",
    "",
  ].join("\n");
  return [{ kind: "index", path: indexPath(input.slug, rootFolder), title: input.archiveTitle, content: index }, ...out];
}

/** Opens a note in the Obsidian app on this device. */
export const obsidianUrl = (vault: string, path: string) => `obsidian://open?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(withoutExt(path))}`;
