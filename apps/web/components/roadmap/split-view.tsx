"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

const KEY = "ultimyr_notes_split";
const MIN = 25;
const MAX = 75;
const clamp = (n: number) => Math.min(MAX, Math.max(MIN, Math.round(n)));

/** The roadmap on the left, the note on the right, with a divider you can drag (or move with the arrow keys). Stacks on narrow screens. */
export function SplitView({ left, right }: { left: ReactNode; right: ReactNode }) {
  const [ratio, setRatio] = useState(50);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const v = Number(localStorage.getItem(KEY));
      if (v) setRatio(clamp(v));
    } catch {
      /* storage can be blocked; the default split is fine */
    }
  }, []);
  const set = useCallback((n: number) => {
    const v = clamp(n);
    setRatio(v);
    try {
      localStorage.setItem(KEY, String(v));
    } catch {
      /* not remembered */
    }
  }, []);

  function drag(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    const el = box.current;
    if (!el) return;
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect();
      set(((ev.clientX - r.left) / r.width) * 100);
    };
    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
  }

  if (!right) return <div>{left}</div>;
  return (
    <div ref={box} className="space-y-4 lg:grid lg:items-start lg:space-y-0" style={{ gridTemplateColumns: `minmax(0, ${ratio}fr) 14px minmax(0, ${100 - ratio}fr)` }}>
      <div>{left}</div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the notes pane"
        aria-valuemin={MIN}
        aria-valuemax={MAX}
        aria-valuenow={ratio}
        tabIndex={0}
        onPointerDown={drag}
        onDoubleClick={() => set(50)}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") set(ratio - 5);
          else if (e.key === "ArrowRight") set(ratio + 5);
          else if (e.key === "Home") set(MIN);
          else if (e.key === "End") set(MAX);
          else return;
          e.preventDefault();
        }}
        className="group hidden h-full min-h-[8rem] cursor-col-resize touch-none items-center justify-center lg:flex"
      >
        <span className="h-16 w-1 rounded-full bg-line group-hover:bg-accent group-focus-visible:bg-accent" />
      </div>
      <div className="lg:sticky lg:top-4">{right}</div>
    </div>
  );
}
