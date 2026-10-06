"use client";

import { localZone, withZone } from "@/lib/tz";
import { clearOffline } from "./offline";
import { startAuthentication } from "@simplewebauthn/browser";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { refreshDelay, tokenExpiry } from "./token";

export interface User {
  id: string;
  email: string;
  displayName: string;
  roles: string[];
}

type State = { status: "loading" } | { status: "anonymous" } | { status: "authenticated"; user: User; accessToken: string };

interface AuthValue {
  state: State;
  /** Resolves with an MFA token when a second factor is required, or a change token when a temporary password must be replaced, otherwise signs in. */
  signIn: (email: string, password: string) => Promise<{ mfaToken: string } | { changeToken: string } | null>;
  /** Replace a temporary password (after signIn returned a change token), then sign in. */
  changePassword: (changeToken: string, currentPassword: string, newPassword: string) => Promise<void>;
  /** Redeem an invite or reset link, then sign in. */
  setPassword: (token: string, password: string) => Promise<void>;
  verifyMfa: (mfaToken: string, input: { code?: string; recoveryCode?: string }) => Promise<void>;
  signInWithPasskey: () => Promise<void>;
  /** Authenticated JSON call to the auth service. Throws ApiError on failure. */
  api: <T = unknown>(method: string, path: string, body?: unknown) => Promise<T>;
  register: (displayName: string, email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthValue | null>(null);

async function post(path: string, body?: unknown) {
  const res = await fetch(`/api/v1/auth/${path}`, {
    method: "POST",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  return res;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public issues: string[] = [],
    /** Request id of a server side failure, quoted in the service log. */
    public ref?: string,
  ) {
    super(code);
  }
}

async function session(res: Response): Promise<{ user: User; accessToken: string }> {
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string; issues?: string[]; ref?: string };
    throw new ApiError(res.status, data.error ?? "unknown_error", data.issues, data.ref);
  }
  return res.json();
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string; issues?: string[]; ref?: string };
    throw new ApiError(res.status, data.error ?? "unknown_error", data.issues, data.ref);
  }
  return res.json();
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: "loading" });

  // The access token lives only in memory; the httpOnly refresh cookie restores the session on load.
  useEffect(() => {
    let cancelled = false;
    post("refresh")
      .then(session)
      .then((s) => !cancelled && setState({ status: "authenticated", ...s }))
      .catch(() => !cancelled && setState({ status: "anonymous" }));
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const res = await post("login", { email, password });
    const data = (await session(res as Response)) as unknown as { mfaRequired?: boolean; mfaToken?: string; passwordChangeRequired?: boolean; changeToken?: string } & { user: User; accessToken: string };
    if (data.passwordChangeRequired && data.changeToken) return { changeToken: data.changeToken };
    if (data.mfaRequired && data.mfaToken) return { mfaToken: data.mfaToken };
    setState({ status: "authenticated", user: data.user, accessToken: data.accessToken });
    return null;
  }, []);
  const changePassword = useCallback(async (changeToken: string, currentPassword: string, newPassword: string) => {
    const s = await session(await post("change-password", { changeToken, currentPassword, newPassword }));
    setState({ status: "authenticated", ...s });
  }, []);
  const setPassword = useCallback(async (token: string, password: string) => {
    const s = await session(await post("set-password", { token, password }));
    setState({ status: "authenticated", ...s });
  }, []);
  const verifyMfa = useCallback(async (mfaToken: string, input: { code?: string; recoveryCode?: string }) => {
    const s = await session(await post("mfa/verify", { mfaToken, ...input }));
    setState({ status: "authenticated", ...s });
  }, []);
  const signInWithPasskey = useCallback(async () => {
    const opts = await json<{ challengeId: string; options: Parameters<typeof startAuthentication>[0]["optionsJSON"] }>(await post("passkeys/login/options", {}));
    const response = await startAuthentication({ optionsJSON: opts.options });
    const s = await session(await post("passkeys/login/verify", { challengeId: opts.challengeId, response }));
    setState({ status: "authenticated", ...s });
  }, []);
  const token = state.status === "authenticated" ? state.accessToken : null;
  // `api` reads the token from a ref so its identity never changes. Pages that reload when `api` changes would otherwise reload every time the token is renewed.
  const tokenRef = useRef<string | null>(null);
  tokenRef.current = token;
  const [retry, setRetry] = useState(0);

  // One renewal at a time. A real refusal (401) signs the person out; a dropped connection keeps the session and tries again shortly.
  const renewing = useRef<Promise<string | null> | null>(null);
  const renew = useCallback(() => {
    renewing.current ??= post("refresh")
      .then(session)
      .then((s) => {
        setState({ status: "authenticated", ...s });
        return s.accessToken;
      })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) setState({ status: "anonymous" });
        else setTimeout(() => setRetry((n) => n + 1), 15_000);
        return null;
      })
      .finally(() => {
        renewing.current = null;
      });
    return renewing.current;
  }, []);

  // Access tokens last 10 minutes. Renew before they run out, and at once when a sleeping tab wakes up late.
  useEffect(() => {
    if (!token) return;
    const expiry = tokenExpiry(token);
    const timer = setTimeout(() => void renew(), refreshDelay(expiry, Date.now()));
    const wake = () => {
      if (document.visibilityState === "visible" && expiry !== null && expiry - Date.now() < 60_000) void renew();
    };
    document.addEventListener("visibilitychange", wake);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [token, renew, retry]);

  const api = useCallback(
    async <T,>(method: string, path: string, body?: unknown): Promise<T> => {
      const send = (t: string | null) =>
        fetch(`/api/v1/${method === "GET" ? withZone(path, localZone()) : path}`, {
          method,
          headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(t ? { authorization: `Bearer ${t}` } : {}) },
          body: body !== undefined ? JSON.stringify(body) : undefined,
          credentials: "same-origin",
        });
      let res = await send(tokenRef.current);
      if (res.status === 401 && tokenRef.current) {
        // The token ran out between renewals (a laptop that slept). Renew it and try once more.
        const fresh = await renew();
        if (fresh) res = await send(fresh);
      }
      if (res.status === 204) return undefined as T;
      return json<T>(res);
    },
    [renew],
  );
  const register = useCallback(async (displayName: string, email: string, password: string) => {
    const s = await session(await post("register", { displayName, email, password }));
    setState({ status: "authenticated", ...s });
  }, []);
  const signOut = useCallback(async () => {
    await post("logout").catch(() => undefined);
    clearOffline();
    setState({ status: "anonymous" });
  }, []);

  const value = useMemo(() => ({ state, signIn, changePassword, setPassword, verifyMfa, signInWithPasskey, api, register, signOut }), [state, signIn, changePassword, setPassword, verifyMfa, signInWithPasskey, api, register, signOut]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside AuthProvider");
  return v;
}
