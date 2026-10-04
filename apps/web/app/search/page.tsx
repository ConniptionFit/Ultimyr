"use client";

import { StatusIcon } from "@ultimyr/ui-icons";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Header } from "@/components/header";
import { Shell } from "@/components/ui";
import { useAuth } from "@/lib/auth";

interface Hit {
  type: "archive" | "item" | "section" | "card";
  id: string;
  archiveId: string;
  itemId: string | null;
  title: string;
  snippet: string;
  anchor: string | null;
}

function Results() {
  const q = useSearchParams().get("q") ?? "";
  const { state, api } = useAuth();
  const router = useRouter();
  const [hits, setHits] = useState<Hit[] | null>(null);

  useEffect(() => {
    if (state.status === "anonymous") router.replace("/login");
    if (state.status !== "authenticated" || !q) return;
    api<{ results: Hit[] }>("GET", `search?q=${encodeURIComponent(q)}`).then((r) => setHits(r.results)).catch(() => setHits([]));
  }, [state.status, q, api, router]);

  if (state.status !== "authenticated" || (q && hits === null)) return <StatusIcon status="loading" size={22} />;
  return (
    <div className="ulti-fade space-y-4">
      <h1 className="text-3xl">Search</h1>
      {!q && <p className="text-muted">Type something in the search box.</p>}
      {q && <p className="text-muted">{hits?.length ?? 0} results for “{q}”</p>}
      <ul className="divide-y divide-line rounded-md border border-line">
        {(hits ?? []).map((h) => (
          <li key={`${h.type}-${h.id}`}>
            <Link href={h.type === "archive" ? `/archives/${h.id}` : `/items/${h.itemId}${h.anchor ? `#${h.anchor}` : ""}`} className="block p-3 hover:bg-surface">
              <span className="block">
                {h.title} <span className="text-xs text-muted">{h.type}</span>
              </span>
              {/* ts_headline only wraps matches in <b>; everything else is escaped here before that is restored. */}
              <span className="block text-sm text-muted" dangerouslySetInnerHTML={{ __html: highlight(h.snippet) }} />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Escape the snippet, then re-enable only the <b> tags Postgres inserted around matches. */
function highlight(s: string): string {
  const esc = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc.replace(/&lt;b&gt;/g, "<b>").replace(/&lt;\/b&gt;/g, "</b>");
}

export default function SearchPage() {
  return (
    <>
      <Header />
      <Shell>
        <Suspense fallback={<StatusIcon status="loading" size={22} />}>
          <Results />
        </Suspense>
      </Shell>
    </>
  );
}
