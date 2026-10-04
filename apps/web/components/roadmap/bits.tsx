import { BookMarked, Dumbbell, ExternalLink, FileText, GraduationCap, Link2, ListVideo, Podcast, Video } from "lucide-react";
import type { ComponentType } from "react";
import { safeHref, type Resource, type ResourceKind, type RoadmapTotals } from "@/lib/types";

export const KIND_ICON: Record<ResourceKind, ComponentType<{ size?: number; className?: string; "aria-hidden"?: boolean }>> = {
  video: Video,
  playlist: ListVideo,
  article: FileText,
  course: GraduationCap,
  docs: FileText,
  practice: Dumbbell,
  book: BookMarked,
  podcast: Podcast,
  other: Link2,
};
export const KIND_LABEL: Record<ResourceKind, string> = { video: "Video", playlist: "Playlist", article: "Article", course: "Course", docs: "Docs", practice: "Practice", book: "Book", podcast: "Podcast", other: "Link" };

export function minutesText(m: number | null | undefined): string | null {
  if (!m) return null;
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

/** A link out to another site. Opens in a new tab and says so for screen readers. */
export function ExternalLinkText({ resource }: { resource: Pick<Resource, "url" | "title" | "provider"> }) {
  const href = safeHref(resource.url);
  if (!href) return <span>{resource.title}</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent underline">
      {resource.title}
      <ExternalLink size={13} aria-hidden />
      <span className="sr-only">(opens {resource.provider || "another site"} in a new tab)</span>
    </a>
  );
}

export function ProgressBar({ totals, label }: { totals: RoadmapTotals; label: string }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-line" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={totals.percent}>
      <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${totals.percent}%` }} />
    </div>
  );
}

export function totalsText(t: RoadmapTotals): string {
  const left = minutesText(t.minutesLeft);
  return `${t.doneRequired} of ${t.required} required steps${left ? ` · about ${left} left` : ""}`;
}
