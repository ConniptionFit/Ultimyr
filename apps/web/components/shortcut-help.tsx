"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export const SHORTCUTS: { area: string; keys: [string, string][] }[] = [
  { area: "Anywhere", keys: [["?", "Show this list"]] },
  {
    area: "Learning path",
    keys: [
      ["J / K", "Next or previous step"],
      ["D", "Mark the step done"],
    ],
  },
  {
    area: "Daily review",
    keys: [
      ["Space", "Show the answer"],
      ["1 to 4", "Rate how well you remembered"],
    ],
  },
  {
    area: "Quizzes and practice exams",
    keys: [
      ["1 to 9", "Pick or untick an option"],
      ["N / P", "Next or previous question"],
      ["F", "Flag the question"],
    ],
  },
];

/** Press ? anywhere (outside a text box) for the list of keyboard shortcuts. */
export function ShortcutHelp() {
  const [open, setOpen] = useState(false);
  const close = useRef<HTMLButtonElement>(null);
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
    if (open) close.current?.focus();
    else if (opener.current instanceof HTMLElement) opener.current.focus();
  }, [open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
      <div role="dialog" aria-modal="true" aria-labelledby="keys-h" onClick={(e) => e.stopPropagation()} className="max-h-full w-full max-w-md overflow-y-auto rounded-lg border border-line bg-bg p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="keys-h" className="text-xl">
            Keyboard shortcuts
          </h2>
          <button ref={close} aria-label="Close" onClick={() => setOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-md border border-line">
            <X size={16} aria-hidden />
          </button>
        </div>
        <div className="space-y-4">
          {SHORTCUTS.map((g) => (
            <section key={g.area}>
              <h3 className="mb-1 text-sm text-muted">{g.area}</h3>
              <dl className="space-y-1">
                {g.keys.map(([k, d]) => (
                  <div key={k} className="flex items-center justify-between gap-3 text-sm">
                    <dt>
                      <kbd className="rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-xs">{k}</kbd>
                    </dt>
                    <dd className="text-muted">{d}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
