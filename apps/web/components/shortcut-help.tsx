"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

const Dialog = dynamic(() => import("./shortcut-dialog"), { ssr: false });

/** Press ? anywhere (outside a text box) for the list of keyboard shortcuts. The dialog loads on first use. */
export function ShortcutHelp() {
  const [open, setOpen] = useState(false);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") return setOpen(false);
      const el = e.target as HTMLElement | null;
      if (e.key !== "?" || e.ctrlKey || e.metaKey || e.altKey) return;
      if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)) return;
      opener.current = document.activeElement;
      setOpen(true);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open && opener.current instanceof HTMLElement) opener.current.focus();
  }, [open]);

  return open ? <Dialog onClose={() => setOpen(false)} /> : null;
}
