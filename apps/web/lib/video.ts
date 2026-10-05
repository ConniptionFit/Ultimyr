import type { Resource } from "./types";

/** How a video can be shown inside the app. `external` means: open the link instead, the site may not allow embedding. */
export type Playback =
  | { mode: "embed"; src: string; provider: string; title: string }
  | { mode: "file"; src: string; type: string }
  | { mode: "external" };

const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const YT_LIST = /^[A-Za-z0-9_-]{10,60}$/;
const FILE_TYPES: Record<string, string> = { mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", ogv: "video/ogg", mov: "video/quicktime" };

/** Start offset in whole seconds from `t=90`, `t=90s` or `t=1m30s`. */
function startSeconds(raw: string | null): number {
  if (!raw) return 0;
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(raw);
  if (!m) return 0;
  const n = Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
  return Number.isFinite(n) && n < 86400 ? n : 0;
}

/**
 * Work out how a saved link can be played in the app. Only providers we know offer an embed are embedded, and always
 * through their privacy-friendly address (YouTube's no-cookie domain, Vimeo's do-not-track flag). Anything else, and
 * anything that is not a video, stays an ordinary link.
 */
export function playbackFor(resource: Pick<Resource, "url" | "kind" | "tags" | "title">): Playback {
  const isVideo = resource.kind === "video" || resource.kind === "playlist" || resource.tags.includes("content-type:video");
  if (!isVideo) return { mode: "external" };
  let u: URL;
  try {
    u = new URL(resource.url);
  } catch {
    return { mode: "external" };
  }
  if (u.protocol !== "https:" || u.username || u.password) return { mode: "external" };
  const host = u.hostname.toLowerCase().replace(/^(www|m|music)\./, "");
  const parts = u.pathname.split("/").filter(Boolean);

  if (host === "youtube.com" || host === "youtu.be" || host === "youtube-nocookie.com") {
    const start = startSeconds(u.searchParams.get("t") ?? u.searchParams.get("start"));
    const list = u.searchParams.get("list");
    let id: string | undefined;
    if (host === "youtu.be") id = parts[0];
    else if (parts[0] === "watch") id = u.searchParams.get("v") ?? undefined;
    else if (["embed", "shorts", "live", "v"].includes(parts[0] ?? "")) id = parts[1];
    const q = new URLSearchParams({ rel: "0" });
    if (start) q.set("start", String(start));
    if (id && YT_ID.test(id)) {
      if (list && YT_LIST.test(list)) q.set("list", list);
      return { mode: "embed", provider: "YouTube", title: resource.title, src: `https://www.youtube-nocookie.com/embed/${id}?${q}` };
    }
    if (list && YT_LIST.test(list) && (parts[0] === "playlist" || parts[0] === "embed" || parts[0] === "watch")) {
      q.set("list", list);
      return { mode: "embed", provider: "YouTube", title: resource.title, src: `https://www.youtube-nocookie.com/embed/videoseries?${q}` };
    }
    return { mode: "external" };
  }

  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const at = host === "player.vimeo.com" ? parts.indexOf("video") + 1 : parts.findIndex((p) => /^\d+$/.test(p));
    const id = at > 0 || (host === "vimeo.com" && at === 0) ? parts[at] : undefined;
    if (!id || !/^\d{4,12}$/.test(id)) return { mode: "external" };
    const q = new URLSearchParams({ dnt: "1" });
    const hash = u.searchParams.get("h") ?? (/^[0-9a-f]{8,16}$/i.test(parts[at + 1] ?? "") ? parts[at + 1] : null);
    if (hash && /^[0-9a-f]{8,16}$/i.test(hash)) q.set("h", hash);
    return { mode: "embed", provider: "Vimeo", title: resource.title, src: `https://player.vimeo.com/video/${id}?${q}` };
  }

  if (host === "loom.com" && (parts[0] === "share" || parts[0] === "embed") && /^[0-9a-f]{32}$/i.test(parts[1] ?? "")) {
    return { mode: "embed", provider: "Loom", title: resource.title, src: `https://www.loom.com/embed/${parts[1]}` };
  }

  const type = FILE_TYPES[(/\.([a-z0-9]{2,4})$/i.exec(u.pathname)?.[1] ?? "").toLowerCase()];
  if (type) return { mode: "file", src: u.toString(), type };
  return { mode: "external" };
}

export const canPlay = (resource: Pick<Resource, "url" | "kind" | "tags" | "title">) => playbackFor(resource).mode !== "external";
