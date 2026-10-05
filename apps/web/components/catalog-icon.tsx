"use client";

import { BookOpen } from "lucide-react";
import { createElement, useEffect, useState, type SVGProps } from "react";

type IconNode = Array<[string, Record<string, string>]>;

// Shapes arrive from /api/icons in small batches and are kept for the life of the page. null means "not in the library".
const known = new Map<string, IconNode | null>();
const waiting = new Map<string, Set<() => void>>();
let queue = new Set<string>();
let timer: ReturnType<typeof setTimeout> | undefined;

async function flush() {
  const names = [...queue];
  queue = new Set();
  timer = undefined;
  for (let i = 0; i < names.length; i += 50) {
    const batch = names.slice(i, i + 50);
    let data: Record<string, IconNode | null> = {};
    try {
      const res = await fetch(`/api/icons?names=${encodeURIComponent(batch.join(","))}`);
      if (res.ok) data = await res.json();
    } catch {
      // Offline: draw the fallback, try again next time the icon is shown.
      for (const n of batch) waiting.get(n)?.forEach((cb) => cb());
      continue;
    }
    for (const n of batch) {
      known.set(n, data[n] ?? null);
      waiting.get(n)?.forEach((cb) => cb());
    }
  }
}

function want(name: string, cb: () => void): () => void {
  (waiting.get(name) ?? waiting.set(name, new Set()).get(name)!).add(cb);
  if (!known.has(name) && !queue.has(name)) {
    queue.add(name);
    timer ??= setTimeout(() => void flush(), 10);
  }
  return () => waiting.get(name)?.delete(cb);
}

export interface CatalogIconProps extends Omit<SVGProps<SVGSVGElement>, "ref"> {
  /** Any icon name from the bundled Lucide library, such as "bot" or "shield-check". */
  name: string;
  size?: number;
  strokeWidth?: number;
}

/** Draws any bundled Lucide icon by name. Falls back to a book for a name that is not in the library. */
export function CatalogIcon({ name, size = 18, strokeWidth = 1.75, className, ...rest }: CatalogIconProps) {
  const [, tick] = useState(0);
  useEffect(() => want(name, () => tick((n) => n + 1)), [name]);
  const node = known.get(name);
  if (node === null) return <BookOpen size={size} strokeWidth={strokeWidth} className={className} aria-hidden {...(rest as object)} />;
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden={rest["aria-label"] ? undefined : true} {...rest}>
      {node?.map(([tag, attrs], i) => createElement(tag, { ...attrs, key: i }))}
    </svg>
  );
}
