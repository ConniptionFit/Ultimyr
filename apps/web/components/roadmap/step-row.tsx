"use client";

import { ArrowRight, BookOpen, Check, ChevronDown, ChevronRight, FileQuestion, Flag, Layers, Minus } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui";
import { useNaming } from "@/lib/naming";
import type { ArchiveNotes } from "@/lib/notes";
import type { Resource, RoadmapStep } from "@/lib/types";
import { VideoPanel, VideoToggleButton, useVideo } from "@/components/video-player";
import { ExternalLinkText, KIND_ICON, KIND_LABEL, minutesText } from "./bits";
import { InlineItem } from "./inline-item";
import { StepNotes } from "./step-notes";

const ITEM_ICON = { guide: BookOpen, deck: Layers, quiz: FileQuestion } as const;

export interface RowProps {
  onTick: (step: RoadmapStep, done: boolean, advance?: boolean) => void;
  archiveId: string;
  /** Guided: the step you are on opens in place with everything it needs. Compact: the plain checklist. */
  guided: boolean;
  /** The next required step that is not done: the one to work on now. */
  currentId: string | null;
  /** Ids of today's session steps (null when no plan is set). */
  today: string[] | null;
  /** The step the keyboard (J and K) is on. */
  cursorId: string | null;
  /** Where a quiz taken from this path returns to. */
  returnTo: string;
  /** This person's notes for the archive; null while loading or if the notes service is unavailable. */
  notes: ArchiveNotes | null;
  onNoteSaved: (stepId: string, has: boolean) => void;
}

/** Stands in for a step that is not a link, so the video hook can always run. Never playable. */
const NO_VIDEO: Pick<Resource, "url" | "kind" | "tags" | "title" | "provider"> = { url: "", kind: "other", tags: [], title: "", provider: "" };

export function StepRow({ step, depth, onTick, archiveId, notes, onNoteSaved, guided, currentId, cursorId, today, returnTo }: { step: RoadmapStep; depth: number } & RowProps) {
  const { t } = useNaming();
  const [open, setOpen] = useState(!step.done);
  const label = step.kind === "milestone" ? step.title! : step.kind === "item" ? step.item!.title : step.resource!.title;
  const Icon = step.kind === "milestone" ? Flag : step.kind === "item" ? ITEM_ICON[step.item!.kind] : KIND_ICON[step.resource!.kind];
  const draftTarget = (step.item?.status ?? step.resource?.status) === "draft";
  const video = useVideo(step.resource ?? NO_VIDEO, guided && step.id === currentId);
  const parent = step.children.length > 0;
  const current = guided && !parent && step.id === currentId;
  const [inline, setInline] = useState(current);
  // A link that opens another site: when you come back to this tab, ask if you finished it.
  const [left, setLeft] = useState(false);
  const [askDone, setAskDone] = useState(false);
  useEffect(() => {
    if (!left) return;
    const back = () => {
      if (document.visibilityState === "visible") {
        setLeft(false);
        setAskDone(true);
      }
    };
    document.addEventListener("visibilitychange", back);
    return () => document.removeEventListener("visibilitychange", back);
  }, [left]);
  // When the path moves on to this step, open what it holds. Closing it again is the learner's call.
  useEffect(() => {
    if (!current) return;
    setInline(true);
    if (video.playable && !video.open) video.toggle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);
  const partial = parent && !step.done && (step.progress?.done ?? 0) > 0;
  const optional = !step.required || step.effectiveRequired === false;
  const meta = [
    step.kind === "item" ? t(step.item!.kind) : step.kind === "resource" ? `${KIND_LABEL[step.resource!.kind]} · ${step.resource!.provider}` : "Checkpoint",
    parent ? `${step.progress!.done} of ${step.progress!.total} done` : null,
    minutesText(parent ? (step.minutesTotal ?? step.minutes) : step.minutes),
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <li id={`step-${step.id}`} className={`scroll-mt-20 ${depth ? "border-t border-line first:border-t-0" : ""} ${current ? "border-l-2 border-l-accent bg-surface/60" : ""} ${cursorId === step.id ? "outline outline-1 outline-accent/60" : ""}`}>
      <div className="flex flex-wrap items-start gap-3 p-3" style={{ paddingLeft: `${0.75 + depth * 1.5}rem` }}>
        {parent ? (
          <button type="button" aria-expanded={open} aria-label={`${open ? "Collapse" : "Expand"} ${label}`} onClick={() => setOpen(!open)} className="mt-0.5 text-muted hover:text-ink">
            {open ? <ChevronDown size={18} aria-hidden /> : <ChevronRight size={18} aria-hidden />}
          </button>
        ) : (
          depth > 0 && <span className="w-[18px] shrink-0" aria-hidden />
        )}
        <button
          role="checkbox"
          aria-checked={partial ? "mixed" : step.done}
          aria-label={`${step.done ? "Mark not done" : "Mark done"}: ${label}${parent ? " and everything inside it" : ""}`}
          onClick={() => onTick(step, !step.done)}
          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border ${step.done ? "border-accent bg-accent text-accent-ink" : partial ? "border-accent text-accent" : "border-line hover:border-accent"}`}
        >
          {step.done ? <Check size={14} aria-hidden /> : partial ? <Minus size={14} aria-hidden /> : null}
        </button>
        <VideoToggleButton video={video} title={label}>
          <Icon size={18} className="mt-0.5 shrink-0 text-muted" aria-hidden />
        </VideoToggleButton>
        <div className="min-w-0 flex-1">
          <p className={step.done ? "text-muted line-through decoration-line" : ""}>
            {step.kind === "item" ? (
              <Link href={`/items/${step.item!.id}`} className="text-accent underline">
                {label}
              </Link>
            ) : step.kind === "resource" ? (
              <span onClick={() => !step.done && !video.playable && setLeft(true)}>
                <ExternalLinkText resource={step.resource!} />
              </span>
            ) : (
              label
            )}
            {optional && <span className="ml-2 rounded-full border border-line px-2 text-xs text-muted no-underline">optional</span>}
            {draftTarget && <span className="ml-2 rounded-full border border-line px-2 text-xs text-muted">draft</span>}
          </p>
          <p className="text-xs text-muted">
            {current && <span className="mr-2 rounded-full bg-accent px-2 py-0.5 text-accent-ink">You are here</span>}
            {today?.includes(step.id) && !step.done && <span className="mr-2 rounded-full border border-accent px-2 py-0.5 text-ink">Today</span>}
            {meta}
          </p>
          {step.note && <p className="mt-1 text-sm text-ink/80">{step.note}</p>}
          {step.kind === "resource" && step.resource!.summary && <p className="mt-1 text-sm text-muted">{step.resource!.summary}</p>}
          {askDone && !step.done && (
            <p role="status" className="mt-1 flex flex-wrap items-center gap-2 text-sm">
              Finished that?
              <Button onClick={() => { setAskDone(false); onTick(step, true, current); }}>Yes, mark it done</Button>
              <Button variant="quiet" onClick={() => setAskDone(false)}>Not yet</Button>
            </p>
          )}
          {step.kind === "item" && !parent && (
            <button type="button" aria-expanded={inline} onClick={() => setInline(!inline)} className="mt-1 text-sm text-accent underline">
              {inline ? "Close" : step.item!.kind === "guide" ? "Read here" : step.item!.kind === "deck" ? "Study here" : "Take it here"}
            </button>
          )}
        </div>
        {step.kind === "item" && !parent && inline && (
          <div className="basis-full">
            <InlineItem itemId={step.item!.id} returnTo={returnTo} onComplete={step.done ? undefined : () => onTick(step, true, current)} />
          </div>
        )}
        {step.resource && <VideoPanel video={video} resource={step.resource} onEnded={step.done ? undefined : () => onTick(step, true, current)} />}
        {!parent && step.kind !== "milestone" && notes && (
          <div className="basis-full pl-8">
            <StepNotes key={`${step.id}-${current}`} defaultOpen={current} archiveId={archiveId} stepId={step.id} title={label} hasNote={!!notes.steps[step.id]} obsidian={notes.connected} onChange={(has) => onNoteSaved(step.id, has)} />
          </div>
        )}
        {current && (
          <div className="flex basis-full items-center justify-end gap-3 pl-8 pt-1">
            <p className="text-xs text-muted">Finished with everything above?</p>
            <Button onClick={() => onTick(step, true, true)}>
              Done, next step <ArrowRight size={16} aria-hidden />
            </Button>
          </div>
        )}
      </div>
      {parent && open && (
        <ul>
          {step.children.map((c) => (
            <StepRow key={c.id} step={c} depth={depth + 1} onTick={onTick} archiveId={archiveId} notes={notes} onNoteSaved={onNoteSaved} guided={guided} currentId={currentId} cursorId={cursorId} today={today} returnTo={returnTo} />
          ))}
        </ul>
      )}
    </li>
  );
}

