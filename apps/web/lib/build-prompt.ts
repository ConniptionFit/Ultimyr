import { FORMAT_EXAMPLE, FORMAT_RULES, PASSES, STANDARDS, depthWords, standardsLines, type Check } from "@ultimyr/bundle";
import type { Depth } from "@ultimyr/coverage";

export const DEPTH_WORDS: Record<Depth, { label: string; detail: string }> = {
  quick: { label: "Quick", detail: "5 flashcards and 3 questions per objective" },
  standard: { label: "Standard", detail: "10 flashcards and 6 questions per objective" },
  deep: { label: "Deep", detail: "20 flashcards and 12 questions per objective" },
};

/** The text to paste into Claude (or another assistant connected to Ultimyr) to build a whole certification. */
export function startPrompt(certification: string, depth: Depth): string {
  const name = certification.trim() || "<certification name>";
  return [
    `Using my Ultimyr connection, build a complete study archive for "${name}". Depth: ${depth}. Do the research yourself and keep going without asking me for anything you can look up. Everything you save is a draft.`,
    "",
    "1. Check list_archives for an existing archive, otherwise create one with create_archive.",
    "2. Research with web search and by opening pages: the official exam guide and objectives, exam facts (format, questions, time, pass score, price, version), vendor training and demos, the recommended study order, the best community guides and videos, and what people who passed report about format and heavily tested topics. Official sources first; use community claims only when several agree and call them community reported. Finish with a short summary of the exam facts with sources, and say what you could not confirm. Only if you cannot browse or cannot find the official objectives, tell me once and ask me to paste them.",
    "3. Save the objectives with set_objectives. Save the useful sources you opened with add_resources, including videos and playlists (YouTube and Vimeo play inside Ultimyr). Never save a link you did not open.",
    "4. Draft a roadmap with import_outline: stages by week, required steps first. After each guide put its flashcard deck and a short quiz, add the videos where they help, and end each stage with a milestone.",
    "5. Call get_build_queue and do every task it returns (guides, flashcards, questions, each linked to its objectives). Call it again until done is true. Guides are in your own words and go beyond the vendor guide with examples, scenarios and common mistakes. Flashcards and questions align with the guides and the research but are never copies of them or of real exam questions, and the questions follow the real exam's reported format and emphasis.",
    "6. Finish with get_coverage and tell me what is thin, what is unconfirmed and what I should review.",
    "",
    "Standards for everything you write:",
    ...[...STANDARDS.guide, ...STANDARDS.deck, ...STANDARDS.quiz].map((r) => `- ${r}`),
  ].join("\n");
}

/** Pick up an archive where an earlier chat stopped. */
export function continuePrompt(title: string, archiveId: string, depth: Depth): string {
  return [
    `Using my Ultimyr connection, continue building the archive "${title}" (id ${archiveId}). Depth: ${depth}.`,
    "Call get_coverage to see where it stands, then work get_build_queue batch by batch until done is true. Link everything to its objectives, write in your own words, and finish with a short coverage report. Everything stays a draft.",
  ].join("\n");
}

const formatBlock = () => [
  "The format:",
  ...FORMAT_RULES.map((r) => `- ${r}`),
  "",
  "A complete example (follow its shape exactly):",
  "```",
  FORMAT_EXAMPLE.trim(),
  "```",
];

const passLines = () => PASSES.map((p) => `${p.id}. ${p.name}: ${p.what}`);

const reply = [
  "How to reply:",
  "- One pass per reply, as ONE code block, with a one-line label above it such as 'Pass B, domain 2 of 5'. Then wait for me to say \"next\".",
  "- Every block closes with === end ===. If you run low on room, stop at a finished block and say what is left.",
  "- Copy objective codes exactly as in the objectives block. Reuse block titles exactly when I ask you to fill gaps.",
];

/** For a chat that cannot connect to Ultimyr: a fixed multi-pass build that ends as text in the bundle format. */
export function bundlePrompt(certification: string, depth: Depth): string {
  const name = certification.trim() || "<certification name>";
  return [
    `I am building a study archive for "${name}". You cannot connect to my app, so write everything as plain text in the exact format below, and I will paste it into Ultimyr, which checks it and tells me what is missing.`,
    "",
    `Target depth: ${depthWords(depth)}, plus one guide for every objective group.`,
    "",
    "Work in these passes, in this order:",
    ...passLines(),
    "",
    "Begin with pass R: do the research yourself and do not wait for me. Only if you cannot browse, or cannot find the official objectives after a real search, tell me once and ask me to paste them.",
    "",
    ...standardsLines(),
    ...reply,
    "",
    ...formatBlock(),
  ].join("\n");
}

/** After a paste: ask the chat to write only what Ultimyr found missing. */
export function gapPrompt(check: Check): string {
  const lines = check.gaps.slice(0, 40).map((g) => {
    const need = [g.guide ? "a guide" : "", g.cardsMissing ? `${g.cardsMissing} more flashcards` : "", g.questionsMissing ? `${g.questionsMissing} more questions` : ""].filter(Boolean);
    return `- ${g.code}: ${need.join(", ")}`;
  });
  return [
    `Ultimyr checked what you wrote. ${check.complete} of ${check.objectives} objectives are complete. Do pass C now: write only what is missing, in the same bundle format and standards as before.`,
    ...lines,
    check.gaps.length > 40 ? `...and ${check.gaps.length - 40} more objectives. Do these first, then I will ask again.` : "",
    check.untaggedQuestions ? `${check.untaggedQuestions} questions have no objective code. Resend them with codes.` : "",
    check.unknownCodes.length ? `These codes are not in the objectives block, so fix or remove them: ${check.unknownCodes.join(", ")}.` : "",
    "Reuse the exact deck and quiz titles from before so nothing duplicates. One code block, ending each block with === end ===.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** SKILL.md for the downloadable Claude Skill: the same passes and standards, so a skill run matches a pasted run. */
export function skillMarkdown(): string {
  return [
    "---",
    "name: ultimyr-course-builder",
    "description: Builds certification study material (objectives, roadmap, guides, flashcards, quizzes) in the Ultimyr bundle format, one exam domain per reply. Use when the user asks for a study guide, course or exam prep for a certification, or says \"ultimyr bundle\".",
    "---",
    "",
    "# Ultimyr course builder",
    "",
    "Write certification study material as plain text in the Ultimyr bundle format. The user pastes each reply into Ultimyr, which checks it, saves drafts and reports gaps. Keep the structure identical between runs.",
    "",
    "## Before you start",
    "Ask only for the target certification and the depth (quick, standard or deep). Then research it yourself; do not wait for the user.",
    `Depth means: quick ${depthWords("quick")}; standard ${depthWords("standard")}; deep ${depthWords("deep")}.`,
    "",
    "## Passes",
    ...passLines(),
    "",
    "## Standards",
    ...standardsLines(),
    "## Replying",
    ...reply.slice(1),
    "- If the user pastes a gap report from Ultimyr, do pass C for exactly those objectives.",
    "",
    "## Format",
    ...formatBlock().slice(1),
    "",
  ].join("\n");
}
