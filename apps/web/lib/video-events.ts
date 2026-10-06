/**
 * Play position and "finished" signals from the embedded players, so a watched video can tick its step and a half
 * watched one can pick up where it stopped. Only the providers' own documented postMessage protocols are used.
 */
export type VideoSignal = { kind: "time"; seconds: number } | { kind: "ended" };

export const YOUTUBE_ORIGIN = "https://www.youtube-nocookie.com";
export const VIMEO_ORIGIN = "https://player.vimeo.com";

/** Messages to send once the player has loaded, to make it start reporting. */
export function listenMessages(provider: string): string[] {
  if (provider === "YouTube") return [JSON.stringify({ event: "listening", id: "ultimyr" })];
  if (provider === "Vimeo") return ["finish", "timeupdate"].map((value) => JSON.stringify({ method: "addEventListener", value }));
  return [];
}

export function originFor(provider: string): string | null {
  return provider === "YouTube" ? YOUTUBE_ORIGIN : provider === "Vimeo" ? VIMEO_ORIGIN : null;
}

/** Read one message from a player (`origin` must already have been checked). Returns null for anything else. */
export function parseSignal(provider: string, data: unknown): VideoSignal | null {
  let m: unknown = data;
  if (typeof data === "string") {
    try {
      m = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (!m || typeof m !== "object") return null;
  const o = m as Record<string, unknown>;
  if (provider === "YouTube") {
    const info = o.info as Record<string, unknown> | number | undefined;
    if (o.event === "onStateChange" && info === 0) return { kind: "ended" };
    if (o.event === "infoDelivery" && info && typeof info === "object" && typeof info.currentTime === "number" && Number.isFinite(info.currentTime)) return { kind: "time", seconds: info.currentTime };
    return null;
  }
  if (provider === "Vimeo") {
    if (o.event === "finish") return { kind: "ended" };
    const d = o.data as Record<string, unknown> | undefined;
    if (o.event === "timeupdate" && d && typeof d.seconds === "number" && Number.isFinite(d.seconds)) return { kind: "time", seconds: d.seconds };
  }
  return null;
}

/** Add a start offset to an embed address (YouTube takes `start`, Vimeo a `#t=` fragment). */
export function withStart(src: string, provider: string, seconds: number): string {
  if (!(seconds >= 5)) return src;
  const s = Math.floor(seconds);
  if (provider === "YouTube") {
    const u = new URL(src);
    u.searchParams.set("start", String(s));
    return u.toString();
  }
  if (provider === "Vimeo") return `${src.split("#")[0]}#t=${s}s`;
  return src;
}

/** Ask a YouTube embed to report back: the JS API flag is needed for its messages to be sent. */
export function withApi(src: string, provider: string): string {
  if (provider !== "YouTube") return src;
  const u = new URL(src);
  u.searchParams.set("enablejsapi", "1");
  return u.toString();
}

const KEY = (url: string) => `ultimyr_video_pos:${url}`;
export function savedPosition(url: string): number {
  try {
    const n = Number(localStorage.getItem(KEY(url)));
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}
export function savePosition(url: string, seconds: number | null) {
  try {
    if (seconds === null || seconds < 5) localStorage.removeItem(KEY(url));
    else localStorage.setItem(KEY(url), String(Math.floor(seconds)));
  } catch {}
}
