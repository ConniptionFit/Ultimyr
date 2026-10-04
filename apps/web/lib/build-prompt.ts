import { FORMAT_EXAMPLE, FORMAT_RULES } from "@ultimyr/bundle";
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
    `Using my Ultimyr connection, build a complete study archive for "${name}". Depth: ${depth}.`,
    "",
    "1. Check list_archives for an existing archive, otherwise create one with create_archive.",
    "2. Ask me for the vendor's official exam objectives (pasted text or a link you can open). If I have none, stop and tell me. Never guess objectives, weights, passing scores or prices.",
    "3. Save the objectives with set_objectives, then add only links I gave you or you opened with add_resources.",
    "4. Draft a roadmap with import_outline: stages by week, required steps first, a milestone after each stage.",
    "5. Call get_build_queue and do every task it returns (guides, flashcards, questions, each linked to its objectives). Call it again until done is true. Write in your own words and never copy exam questions or vendor text.",
    "6. Finish with get_coverage and tell me what is thin and what I should review. Everything is a draft.",
  ].join("\n");
}

/** Pick up an archive where an earlier chat stopped. */
export function continuePrompt(title: string, archiveId: string, depth: Depth): string {
  return [
    `Using my Ultimyr connection, continue building the archive "${title}" (id ${archiveId}). Depth: ${depth}.`,
    "Call get_coverage to see where it stands, then work get_build_queue batch by batch until done is true. Link everything to its objectives, write in your own words, and finish with a short coverage report. Everything stays a draft.",
  ].join("\n");
}

/** For a chat that cannot connect to Ultimyr: it writes the whole certification as text in the bundle format. */
export function bundlePrompt(certification: string, depth: Depth): string {
  const name = certification.trim() || "<certification name>";
  const want = { quick: "about 5 flashcards and 3 questions", standard: "about 10 flashcards and 6 questions", deep: "about 20 flashcards and 12 questions" }[depth];
  return [
    `I am building a study archive for "${name}". You cannot connect to my app, so write everything as plain text in the exact format below, and I will paste it into Ultimyr.`,
    "",
    "Rules for you:",
    "- First ask me for the vendor's official exam objectives (pasted or a link you can open). If I have none, tell me and stop. Never guess objectives, exam weights, passing scores or prices.",
    `- Cover every objective with a guide, ${want} per objective, and a roadmap by week. Write in your own words. Never copy exam questions or vendor text, and leave out facts you are unsure of.`,
    "- Work in chunks that fit in one reply. Chunk 1: the header, objectives and roadmap. Then one chunk per exam domain with its guide, deck and quiz blocks. Put each chunk in one code block, say which chunk it is, and wait for me to say \"next\".",
    "- Every chunk must be complete: close every block with === end ===. If you run out of room, stop at a finished block.",
    "",
    "The format:",
    ...FORMAT_RULES.map((r) => `- ${r}`),
    "",
    "A complete example:",
    "```",
    FORMAT_EXAMPLE.trim(),
    "```",
  ].join("\n");
}
