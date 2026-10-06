"use client";

import { useEffect, useState } from "react";

/** True on phone and small tablet widths (below the lg breakpoint). False until mounted so server and client markup agree. */
export function useNarrow(query = "(max-width: 1023px)"): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setNarrow(m.matches);
    on();
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, [query]);
  return narrow;
}
