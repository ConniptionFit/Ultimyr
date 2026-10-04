"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Loading } from "@/components/loading";
import { Header } from "@/components/header";
import { Button, Shell } from "@/components/ui";
import { rememberReturn } from "@/lib/after-login";
import { ApiError, useAuth } from "@/lib/auth";

const SCOPE_TEXT: Record<string, string> = {
  "content:read": "Read your archives, guides and flashcards",
  "content:write": "Create and edit guides and decks (saved as drafts)",
  "content:share": "Share your material with other people",
  "quiz:read": "Read your quizzes and your progress",
  "quiz:write": "Add quiz questions (saved as drafts)",
  "ai:use": "Use your saved AI keys",
  "notes:use": "Read and write your study notes in Obsidian",
};

function Consent() {
  const q = useSearchParams();
  const { state, api } = useAuth();
  const router = useRouter();
  const [name, setName] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const clientId = q.get("client_id") ?? "";
  const redirectUri = q.get("redirect_uri") ?? "";
  const challenge = q.get("code_challenge") ?? "";
  const state_ = q.get("state") ?? undefined;
  const scopes = (q.get("scope") ?? "").split(/\s+/).filter(Boolean);

  useEffect(() => {
    if (state.status === "anonymous") {
      rememberReturn(`/connect?${q.toString()}`);
      router.replace("/login");
    }
  }, [state.status, router, q]);

  useEffect(() => {
    if (state.status !== "authenticated") return;
    setPicked(scopes);
    api<{ name: string; redirectUris: string[] }>("GET", `oauth/clients/${encodeURIComponent(clientId)}`)
      .then((c) => (c.redirectUris.includes(redirectUri) ? setName(c.name) : setError("This request is not valid.")))
      .catch(() => setError("This request is not valid."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status, clientId, redirectUri]);

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ redirectTo: string }>("POST", "oauth/consent", { clientId, redirectUri, scope: picked.length ? picked : scopes, state: state_, codeChallenge: challenge, approve });
      window.location.href = r.redirectTo;
    } catch (e) {
      setBusy(false);
      setError(e instanceof ApiError && e.code === "too_many_connections" ? "You have too many connected apps. Remove one in Settings first." : "Could not finish. Try again.");
    }
  }

  if (state.status !== "authenticated" || (!name && !error)) return <Loading />;
  if (error && !name) return <p role="alert">{error}</p>;

  let host = redirectUri;
  try {
    host = new URL(redirectUri).host || redirectUri;
  } catch {
    /* shown as is */
  }
  return (
    <div className="ulti-fade space-y-6">
      <div>
        <h1 className="text-2xl">Connect {name}?</h1>
        <p className="text-sm text-muted">
          {name} is asking to use your Ultimyr account. You will be sent back to <span className="font-medium text-ink">{host}</span>. Only continue if you started this.
        </p>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm text-muted">It will be able to</legend>
        {scopes.map((s) => (
          <label key={s} className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={picked.includes(s)} onChange={(e) => setPicked(e.target.checked ? [...picked, s] : picked.filter((x) => x !== s))} className="mt-1" />
            <span>{SCOPE_TEXT[s] ?? s}</span>
          </label>
        ))}
      </fieldset>
      <p className="text-xs text-muted">Anything it writes is saved as a draft for you to review. You can disconnect it any time in Settings.</p>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <Button onClick={() => decide(true)} disabled={busy || picked.length === 0}>Connect</Button>
        <Button variant="quiet" onClick={() => decide(false)} disabled={busy}>Cancel</Button>
      </div>
    </div>
  );
}

export default function ConnectPage() {
  return (
    <>
      <Header />
      <Shell narrow>
        <Suspense fallback={<Loading />}>
          <Consent />
        </Suspense>
      </Shell>
    </>
  );
}
