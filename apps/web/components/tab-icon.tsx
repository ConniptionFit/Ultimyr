"use client";

import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { useDisplay } from "@/lib/display";

/** Lucide graduation-cap (ISC). Stroke colour is filled in at runtime. */
const cap = (color: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z"/><path d="M22 10v6"/><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"/></svg>`;
const DEFAULT_COLOR = "#6fb5a5"; // the dark mode accent, used before sign in

/** Keeps the browser tab icon in the colour of the signed in person's theme. Signed out pages keep the static dark mode icon. */
export function TabIcon() {
  const { state } = useAuth();
  const { display } = useDisplay();
  const signedIn = state.status === "authenticated";

  useEffect(() => {
    const links = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]'));
    const ours = links.filter((l) => l.dataset.tabIcon === "1");
    const apply = () => {
      const color = signedIn ? getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || DEFAULT_COLOR : DEFAULT_COLOR;
      const href = `data:image/svg+xml,${encodeURIComponent(cap(color))}`;
      let link = ours[0];
      if (!link) {
        link = document.createElement("link");
        link.rel = "icon";
        link.type = "image/svg+xml";
        link.dataset.tabIcon = "1";
        document.head.appendChild(link);
      }
      link.href = href;
    };
    // The provider sets data-theme in its own effect, which runs after this one, so wait a tick.
    const t = window.setTimeout(apply, 0);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", apply);
    return () => {
      window.clearTimeout(t);
      mq.removeEventListener("change", apply);
    };
  }, [signedIn, display.theme]);

  return null;
}
