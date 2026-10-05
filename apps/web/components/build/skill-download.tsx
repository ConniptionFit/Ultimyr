"use client";

import { Button } from "@/components/ui";
import { skillMarkdown } from "@/lib/build-prompt";
import { zip } from "@/lib/zip";

/** The same passes and standards as the pasted prompt, as a Claude Skill (Settings > Capabilities > Skills > Upload). */
export function SkillDownload() {
  function download() {
    const bytes = zip([{ path: "ultimyr-course-builder/SKILL.md", text: skillMarkdown() }]);
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "ultimyr-course-builder.zip";
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="rounded-md border border-line p-3 text-sm text-ink">
      <p className="font-medium">Use it every time: the Claude Skill</p>
      <p className="mt-1 text-muted">
        Upload this once in Claude (Settings, Capabilities, Skills). From then on, ask for a study guide for any certification and Claude follows the same passes and standards as the prompt below.
      </p>
      <Button className="mt-2" onClick={download}>
        Download the skill
      </Button>
    </div>
  );
}
