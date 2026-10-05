import type { ItemDetail } from "./types";

/**
 * Opt-in offline copies of guides and decks, kept on this device only (localStorage) and removed when you sign out.
 * Nothing is saved unless you press "Keep for offline reading".
 */
const PREFIX = "ultimyr_offline:";

export const offlineKey = (id: string) => `${PREFIX}${id}`;

export function saveOffline(item: ItemDetail): boolean {
  if (item.kind === "quiz") return false;
  try {
    localStorage.setItem(offlineKey(item.id), JSON.stringify({ savedAt: Date.now(), item }));
    return true;
  } catch {
    return false; // storage full or blocked
  }
}

export function loadOffline(id: string): { savedAt: number; item: ItemDetail } | null {
  try {
    const raw = localStorage.getItem(offlineKey(id));
    return raw ? (JSON.parse(raw) as { savedAt: number; item: ItemDetail }) : null;
  } catch {
    return null;
  }
}

export function dropOffline(id: string) {
  try {
    localStorage.removeItem(offlineKey(id));
  } catch {}
}

/** Remove every offline copy and the cached pages. Called on sign out. */
export function clearOffline() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(PREFIX)) localStorage.removeItem(k);
  } catch {}
  try {
    navigator.serviceWorker?.controller?.postMessage({ type: "clear-pages" });
  } catch {}
}
