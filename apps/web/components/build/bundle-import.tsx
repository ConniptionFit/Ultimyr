"use client";

import { checkBundles, parseBundle, summarize } from "@ultimyr/bundle";
import type { Depth } from "@ultimyr/coverage";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { PromptBox } from "@/components/build/prompt-box";
import { Button } from "@/components/ui";
import { ApiError, useAuth } from "@/lib/auth";
import { gapPrompt } from "@/lib/build-prompt";
import { runBundle, type RunResult } from "@/lib/bundle-run";
import type { Archive } from "@/lib/types";

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** Paste (or upload) text a chat wrote in the bundle format, check it, and save it as drafts. */
export function BundleImport({ depth = "standard" }: { depth?: Depth }) {
  const { api } = useAuth();
  const [text, setText] = useState("");
  const [archives, setArchives] = useState<Archive[]>([]);
  const [target, setTarget] = useState("new");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [done, setDone] = useState<RunResult | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    api<{ archives: Archive[] }>("GET", "archives?scope=mine")
      .then((r) => setArchives(r.archives))
      .catch(() => setArchives([]));
  }, [api]);

  const bundle = useMemo(() => (text.trim() ? parseBundle(text) : null), [text]);
  const check = useMemo(() => (bundle && !bundle.errors.length ? checkBundles([bundle], depth) : null), [bundle, depth]);
  const sum = bundle ? summarize(bundle) : null;
  const empty = sum && !sum.objectives && !sum.roadmap && !sum.guides && !sum.decks && !sum.quizzes;
  const needsArchive = target === "new" && !!bundle && !bundle.archive.title;
  const ok = !!bundle && !bundle.errors.length && !empty && !needsArchive;

  async function save() {
    if (!bundle || !ok) return;
    setBusy(true);
    setFailure(null);
    setDone(null);
    try {
      setDone(await runBundle(api, bundle, target === "new" ? {} : { archiveId: target }, setStep));
      setText("");
    } catch (e) {
      const issues = e instanceof ApiError && e.issues.length ? ` (${e.issues.join("; ")})` : "";
      setFailure(`${e instanceof Error ? e.message : "Something went wrong"}${issues}. At "${step}". Fix the text and save again: what is already saved is not duplicated.`);
    } finally {
      setBusy(false);
      setStep("");
    }
  }

  return (
    <div className="space-y-4">
      <label className="block text-sm text-ink">
        Paste what the chat wrote. For several chunks, paste them one after another.
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={10} spellCheck={false} placeholder="ultimyr-bundle v1&#10;archive: ..." className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 font-mono text-sm text-ink" />
      </label>
      <label className="block text-sm text-ink">
        Or upload a text file{" "}
        <input
          type="file"
          accept=".txt,.md,text/plain,text/markdown"
          className="text-sm text-muted file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:text-sm file:text-ink hover:file:bg-bg"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) {
              const more = await f.text();
              setText((t) => (t ? `${t}\n\n` : "") + more);
            }
            e.target.value = "";
          }}
        />
      </label>

      {bundle && (
        <div className="space-y-2 rounded-md border border-line p-3 text-sm" aria-live="polite">
          {sum && !empty && (
            <p className="text-ink">
              Found {plural(sum.guides, "guide")}, {plural(sum.decks, "deck")} ({plural(sum.cards, "card")}), {plural(sum.quizzes, "quiz")} ({plural(sum.questions, "question")}){sum.objectives ? `, ${plural(sum.objectives, "objective line")}` : ""}
              {sum.roadmap ? ", and a roadmap" : ""}.
            </p>
          )}
          {empty && !bundle.errors.length && <p className="text-danger">Nothing readable yet. Check that the blocks start with &quot;=== guide: Title ===&quot; and end with &quot;=== end ===&quot;.</p>}
          {needsArchive && <p className="text-danger">There is no archive: line. Choose an existing archive below.</p>}
          {bundle.errors.length > 0 && (
            <div>
              <p className="font-medium text-danger">Fix these first ({bundle.errors.length}):</p>
              <ul className="list-disc pl-5 text-danger">
                {bundle.errors.slice(0, 12).map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
              {bundle.errors.length > 12 && <p className="text-muted">...and {bundle.errors.length - 12} more.</p>}
            </div>
          )}
          {bundle.warnings.length > 0 && (
            <ul className="list-disc pl-5 text-muted">
              {bundle.warnings.slice(0, 5).map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {check && check.objectives > 0 && (
        <div className="space-y-2 rounded-md border border-line p-3 text-sm" aria-live="polite">
          <p className="text-ink">
            Coverage check ({depth}): {check.complete} of {plural(check.objectives, "objective")} complete in the text above.
            {check.gaps.length === 0 && " Nothing missing."}
          </p>
          {check.gaps.length > 0 && (
            <>
              <ul className="list-disc pl-5 text-muted">
                {check.gaps.slice(0, 6).map((g) => (
                  <li key={g.code}>
                    {g.code}: {[g.guide ? "no guide" : "", g.cardsMissing ? `${g.cardsMissing} cards short` : "", g.questionsMissing ? `${g.questionsMissing} questions short` : ""].filter(Boolean).join(", ")}
                  </li>
                ))}
                {check.gaps.length > 6 && <li>...and {check.gaps.length - 6} more.</li>}
              </ul>
              <PromptBox label="Ask the chat to fill the gaps" prompt={gapPrompt(check)} connection={false} />
            </>
          )}
        </div>
      )}

      <label className="block text-sm text-ink">
        Save into
        <select value={target} onChange={(e) => setTarget(e.target.value)} className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2">
          <option value="new">A new archive{bundle?.archive.title ? `: ${bundle.archive.title}` : " (named in the text)"}</option>
          {archives.map((a) => (
            <option key={a.id} value={a.id}>
              {a.title}
            </option>
          ))}
        </select>
      </label>
      <Button onClick={save} disabled={!ok || busy}>
        {busy ? `${step || "Saving"}...` : "Save as drafts"}
      </Button>

      {failure && (
        <p role="alert" className="text-sm text-danger">
          {failure}
        </p>
      )}
      {done && (
        <div role="status" className="rounded-md border border-line p-3 text-sm text-ink">
          <p>
            Saved as drafts: {plural(done.created.guides, "guide")}, {plural(done.created.decks, "deck")}, {plural(done.created.cards, "card")}, {plural(done.created.quizzes, "quiz")}, {plural(done.created.questions, "question")}
            {done.created.roadmap ? ", and a roadmap" : ""}. Review and publish them in the archive.
          </p>
          {[...done.skipped, ...done.warnings].length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-muted">
              {[...done.skipped, ...done.warnings].slice(0, 10).map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          )}
          <p className="mt-2">
            <Link href={`/archives/${done.archiveId}`} className="underline">
              Open the archive
            </Link>{" "}
            (the Coverage tab shows what is still missing).
          </p>
        </div>
      )}
    </div>
  );
}

/** The prompt for chats that cannot connect, with its own heading. */
export function BundlePrompt({ prompt }: { prompt: string }) {
  return <PromptBox label="Prompt for a chat without a connector" prompt={prompt} connection={false} />;
}
