"use client";

import { useCallback, useEffect, useState } from "react";
import type { Protocol } from "./sso-providers";

const KEY = "ultimyr_sso_guide";

export interface SsoSetup {
  provider: string;
  protocol: Protocol;
  /** What was typed per provider (address, application slug or tenant). */
  fields: Record<string, { base?: string; app?: string }>;
  slugs: Record<string, string>;
  done: Record<string, number[]>;
}

const empty: SsoSetup = { provider: "authentik", protocol: "oidc", fields: {}, slugs: {}, done: {} };

function read(): SsoSetup {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? { ...empty, ...(JSON.parse(raw) as Partial<SsoSetup>) } : empty;
  } catch {
    return empty;
  }
}

/** The guide and the Add a provider form share one setup, remembered in this browser (never anything secret). */
export function useSsoSetup(): [SsoSetup, (patch: Partial<SsoSetup>) => void] {
  const [setup, setSetup] = useState<SsoSetup>(empty);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setSetup(read());
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    try {
      window.localStorage.setItem(KEY, JSON.stringify(setup));
    } catch {
      /* private mode: setup still works without remembering */
    }
  }, [setup, ready]);
  const update = useCallback((patch: Partial<SsoSetup>) => setSetup((s) => ({ ...s, ...patch })), []);
  return [setup, update];
}
