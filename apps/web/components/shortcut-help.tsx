"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

const Dialog = dynamic(() => import("./shortcut-dialog"), { ssr: false });

/** Press ? anywhere (outside a text box) for the list of keyboard shortcuts. The dialog loads on first use. */
export function ShortcutHelp() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      if (e.key !== "?" || e.ctrlKey || e.metaKey || e.altKey) return;
      if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)) return;
      setOpen(true);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return open ? <Dialog onClose={() => setOpen(false)} /> : null;
}
