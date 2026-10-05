"use client";

import type { Depth } from "@ultimyr/coverage";
import { Sparkles } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { BundleImport, BundlePrompt } from "@/components/build/bundle-import";
import { SkillDownload } from "@/components/build/skill-download";
import { PromptBox } from "@/components/build/prompt-box";
import { DEPTH_WORDS, bundlePrompt, startPrompt } from "@/lib/build-prompt";
import { useNaming } from "@/lib/naming";
import { RequireSession } from "@/lib/require-session";

const input = "w-full rounded-md border border-line bg-surface px-3 py-2 text-ink";
const STEPS = [
  "Connect your assistant once (the address is under the prompt).",
  "Paste the prompt. The assistant researches the certification itself (official guide, exam facts, training, community guides and videos) and only asks you if it cannot find the objectives.",
  "It saves the objectives, sources and videos (which play inside Ultimyr), a roadmap, guides, flashcards and questions, in small batches, as drafts.",
  "Open the archive, check the Coverage tab, then review and publish the drafts.",
];

function Build() {
  const { t } = useNaming();
  const [name, setName] = useState("");
  const [depth, setDepth] = useState<Depth>("standard");
  return (
    <div className="ulti-fade max-w-2xl space-y-8">
      <div>
        <h1 className="flex items-center gap-2 text-3xl">
          <Sparkles aria-hidden /> {t("build")}
        </h1>
        <p className="mt-1 text-sm text-muted">Describe the certification once and let Claude, or any assistant that supports MCP, build the whole study archive for you. Everything it writes is a draft until you publish it.</p>
      </div>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-ink">
        {STEPS.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      <div className="space-y-4">
        <label className="block text-sm text-ink">
          Certification
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="CompTIA A+ 220-1201" maxLength={200} className={`${input} mt-1`} />
        </label>
        <fieldset>
          <legend className="text-sm text-ink">How much to build</legend>
          <div className="mt-1 flex flex-wrap gap-4">
            {(Object.keys(DEPTH_WORDS) as Depth[]).map((d) => (
              <label key={d} className="flex items-center gap-2 text-sm text-ink">
                <input type="radio" name="depth" checked={depth === d} onChange={() => setDepth(d)} /> {DEPTH_WORDS[d].label}
                <span className="text-muted">({DEPTH_WORDS[d].detail})</span>
              </label>
            ))}
          </div>
        </fieldset>
        <PromptBox label="Prompt to paste" prompt={startPrompt(name, depth)} />
      </div>
      <section aria-labelledby="paste-h" className="space-y-4 border-t border-line pt-6">
        <h2 id="paste-h" className="text-xl">
          No connector? Copy and paste instead
        </h2>
        <p className="text-sm text-muted">Works with any chat (Gemini, ChatGPT, Claude without a connector) and needs no API key. The chat writes everything as text in a strict format, in chunks if it is long. You paste it here, Ultimyr checks it line by line, and saves it as drafts.</p>
        <BundlePrompt prompt={bundlePrompt(name, depth)} />
        <BundleImport depth={depth} />
        <SkillDownload />
      </section>
      <p className="text-sm text-muted">
        Already have an archive? Open its <strong>Coverage</strong> tab for a prompt that continues it. Your archives are in the <Link href="/reading-room" className="underline">Reading Room</Link>.
      </p>
    </div>
  );
}

export default function BuildPage() {
  return (
    <RequireSession>
      <Build />
    </RequireSession>
  );
}
