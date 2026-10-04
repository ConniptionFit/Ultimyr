"use client";

import { StatusIcon } from "@ultimyr/ui-icons";
import { terms, type TermKey } from "@ultimyr/lore";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Header } from "@/components/header";
import { Shell } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useNaming } from "@/lib/naming";

export default function Settings() {
  const { state } = useAuth();
  const { mode, setMode } = useNaming();
  const router = useRouter();

  useEffect(() => {
    if (state.status === "anonymous") router.replace("/login");
  }, [state.status, router]);

  return (
    <>
      <Header />
      <Shell>
        {state.status !== "authenticated" ? (
          <StatusIcon status="loading" size={22} />
        ) : (
          <div className="ulti-fade space-y-8">
            <h1 className="text-3xl">Settings</h1>
            <section className="space-y-4">
              <div className="flex items-start justify-between gap-6">
                <div>
                  <h2 className="text-xl">Themed names</h2>
                  <p className="text-sm text-muted">
                    Show Ultimyr&apos;s Archive-inspired names, or switch to plain labels. Only the labels change.
                  </p>
                </div>
                <button
                  role="switch"
                  aria-checked={mode === "themed"}
                  aria-label="Themed names"
                  onClick={() => setMode(mode === "themed" ? "plain" : "themed")}
                  className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${mode === "themed" ? "bg-accent" : "bg-line"}`}
                >
                  <span
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-surface transition-transform ${mode === "themed" ? "translate-x-5" : "translate-x-0.5"}`}
                  />
                </button>
              </div>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-md border border-line p-4 text-sm">
                {(Object.keys(terms) as TermKey[]).map((k) => (
                  <div key={k} className="contents">
                    <dt className="text-muted">{terms[k].plain}</dt>
                    <dd>{terms[k].themed}</dd>
                  </div>
                ))}
              </dl>
            </section>
          </div>
        )}
      </Shell>
    </>
  );
}
