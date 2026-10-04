"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { DEFAULT_DISPLAY, DISPLAY_COOKIE, displayAttrs, serializeDisplay, type Display } from "./display-shared";
export { DEFAULT_DISPLAY, DISPLAY_COOKIE, displayAttrs, parseDisplay, serializeDisplay, type Display } from "./display-shared";

interface DisplayValue {
  display: Display;
  setDisplay: (patch: Partial<Display>) => void;
  /** Focus mode hides everything but the task. Not remembered between visits. */
  focus: boolean;
  setFocus: (on: boolean) => void;
}
const Ctx = createContext<DisplayValue>({ display: DEFAULT_DISPLAY, setDisplay: () => {}, focus: false, setFocus: () => {} });

export function DisplayProvider({ initial, children }: { initial: Display; children: ReactNode }) {
  const [display, setState] = useState(initial);
  const [focus, setFocus] = useState(false);
  const setDisplay = useCallback((patch: Partial<Display>) => {
    setState((cur) => {
      const next = { ...cur, ...patch };
      document.cookie = `${DISPLAY_COOKIE}=${serializeDisplay(next)}; path=/; max-age=31536000; samesite=lax`;
      return next;
    });
  }, []);

  useEffect(() => {
    const el = document.documentElement;
    for (const [k, v] of Object.entries(displayAttrs(display))) {
      if (v) el.setAttribute(k, v);
      else el.removeAttribute(k);
    }
  }, [display]);

  const value = useMemo(() => ({ display, setDisplay, focus, setFocus }), [display, setDisplay, focus]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useDisplay = () => useContext(Ctx);
