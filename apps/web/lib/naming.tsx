"use client";

import { DEFAULT_NAMING, NAMING_COOKIE, term, text, type CopyKey, type NamingMode, type TermKey } from "@ultimyr/lore";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

interface NamingValue {
  mode: NamingMode;
  setMode: (m: NamingMode) => void;
  t: (key: TermKey) => string;
  copy: (key: CopyKey) => string;
}

const Ctx = createContext<NamingValue>({
  mode: DEFAULT_NAMING,
  setMode: () => {},
  t: (k) => term(k, DEFAULT_NAMING),
  copy: (k) => text(k, DEFAULT_NAMING),
});

export function NamingProvider({ initial, children }: { initial: NamingMode; children: ReactNode }) {
  const [mode, setModeState] = useState<NamingMode>(initial);
  const setMode = useCallback((m: NamingMode) => {
    setModeState(m);
    document.cookie = `${NAMING_COOKIE}=${m}; path=/; max-age=31536000; samesite=lax`;
  }, []);
  const value = useMemo<NamingValue>(
    () => ({ mode, setMode, t: (k) => term(k, mode), copy: (k) => text(k, mode) }),
    [mode, setMode],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useNaming = () => useContext(Ctx);
