/** How the app looks and behaves for one person. Kept in a cookie so the server can render the right look on first paint. */
export interface Display {
  theme: "system" | "light" | "dark";
  size: "default" | "large" | "xlarge";
  /** A wider spaced, evenly shaped sans for easier reading. */
  readable: boolean;
  /** Stop animation and transitions regardless of the system setting. */
  calm: boolean;
  /** Extra time on timed exams, in percent. Self declared and recorded on the attempt. */
  extraTime: 0 | 25 | 50 | 100;
}
export const DISPLAY_COOKIE = "ultimyr_display";
export const DEFAULT_DISPLAY: Display = { theme: "system", size: "default", readable: false, calm: false, extraTime: 0 };

export function parseDisplay(raw: string | undefined | null): Display {
  const d = { ...DEFAULT_DISPLAY };
  for (const part of (raw ?? "").split("|")) {
    const [k, v] = part.split(":");
    if (k === "t" && (v === "light" || v === "dark")) d.theme = v;
    if (k === "s" && (v === "large" || v === "xlarge")) d.size = v;
    if (k === "f" && v === "1") d.readable = true;
    if (k === "m" && v === "1") d.calm = true;
    if (k === "x" && (v === "25" || v === "50" || v === "100")) d.extraTime = Number(v) as Display["extraTime"];
  }
  return d;
}

export function serializeDisplay(d: Display): string {
  const parts: string[] = [];
  if (d.theme !== "system") parts.push(`t:${d.theme}`);
  if (d.size !== "default") parts.push(`s:${d.size}`);
  if (d.readable) parts.push("f:1");
  if (d.calm) parts.push("m:1");
  if (d.extraTime) parts.push(`x:${d.extraTime}`);
  return parts.join("|");
}

/** The attributes the stylesheet keys off. Used on the server for first paint and on the client for live changes. */
export function displayAttrs(d: Display) {
  return {
    "data-theme": d.theme === "system" ? undefined : d.theme,
    "data-size": d.size === "default" ? undefined : d.size,
    "data-font": d.readable ? "readable" : undefined,
    "data-motion": d.calm ? "calm" : undefined,
  } as const;
}

