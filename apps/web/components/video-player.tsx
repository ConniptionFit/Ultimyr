"use client";

import { ExternalLink, Play, X } from "lucide-react";
import { useId, useState } from "react";
import { safeHref, type Resource } from "@/lib/types";
import { playbackFor, type Playback } from "@/lib/video";

type VideoResource = Pick<Resource, "url" | "kind" | "tags" | "title" | "provider">;

/** Open or close state for one video, plus what to render. `playable` is false for anything that is not a known video. */
export function useVideo(resource: VideoResource) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const playback = playbackFor(resource);
  return { playable: playback.mode !== "external", playback, open, panelId, toggle: () => setOpen((o) => !o), close: () => setOpen(false) };
}

/** The tile icon of a playable video: a button that drops the player down. Other links keep their plain icon. */
export function VideoToggleButton({ video, title, children }: { video: ReturnType<typeof useVideo>; title: string; children: React.ReactNode }) {
  if (!video.playable) return <>{children}</>;
  return (
    <button
      type="button"
      aria-expanded={video.open}
      aria-controls={video.panelId}
      aria-label={`${video.open ? "Close the player for" : "Play"} ${title}`}
      onClick={video.toggle}
      className={`group mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border ${video.open ? "border-accent bg-surface text-accent" : "border-line text-muted hover:border-accent hover:text-accent"}`}
    >
      <Play size={14} aria-hidden className={video.open ? "fill-current" : "group-hover:fill-current"} />
    </button>
  );
}

/** The dropped down player. Mounts only while open, so nothing loads (and no third party hears about you) until asked. */
export function VideoPanel({ video, resource }: { video: ReturnType<typeof useVideo>; resource: VideoResource }) {
  if (!video.playable) return null;
  return (
    <div id={video.panelId} hidden={!video.open} className="basis-full">
      {video.open && <Player playback={video.playback} resource={resource} onClose={video.close} />}
    </div>
  );
}

function Player({ playback, resource, onClose }: { playback: Playback; resource: VideoResource; onClose: () => void }) {
  const href = safeHref(resource.url);
  return (
    <div className="mt-2 space-y-2 rounded-md border border-line bg-surface p-2">
      {playback.mode === "embed" && (
        <div className="aspect-video w-full overflow-hidden rounded bg-black">
          <iframe
            src={playback.src}
            title={`${resource.title} (${playback.provider} player)`}
            className="h-full w-full border-0"
            loading="lazy"
            allow="fullscreen; picture-in-picture; encrypted-media; accelerometer; gyroscope"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox"
          />
        </div>
      )}
      {playback.mode === "file" && (
        <video controls preload="metadata" playsInline className="aspect-video w-full rounded bg-black" aria-label={resource.title}>
          <source src={playback.src} type={playback.type} />
          Your browser cannot play this video. Use the link below instead.
        </video>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span>{playback.mode === "embed" ? `Playing from ${playback.provider} in a privacy-friendly player.` : "Playing from the saved link."}</span>
        <span className="flex items-center gap-3">
          {href && (
            <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent underline">
              Blank or blocked? Open the original <ExternalLink size={12} aria-hidden />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          )}
          <button type="button" onClick={onClose} className="inline-flex items-center gap-1 hover:text-ink">
            <X size={12} aria-hidden /> Close
          </button>
        </span>
      </div>
    </div>
  );
}
