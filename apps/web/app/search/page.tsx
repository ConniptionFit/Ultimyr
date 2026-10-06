"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Loading } from "@/components/loading";
import { Header } from "@/components/header";
import { Shell } from "@/components/ui";
import { useNaming } from "@/lib/naming";
import { useAuth } from "@/lib/auth";

interface Hit {
  type: "archive" | "item" | "section" | "card" | "resource";
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
  const { copy, t } = useNaming();
  const [only, setOnly] = useState<Hit["type"] | "all">("all");
  const router = useRouter();
  const [hits, setHits] = useState<Hit[] | null>(null);

  useEffect(() => {
    if (state.status === "anonymous") router.replace("/login");
    if (state.status !== "authenticated" || !q) return;
    api<{ results: Hit[] }>("GET", `search?q=${encodeURIComponent(q)}`).then((r) => setHits(r.results)).catch(() => setHits([]));
  }, [state.status, q, api, router]);

  useEffect(() => setOnly("all"), [q]);

  if (state.status !== "authenticated" || (q && hits === null)) return <Loading />;
  const label: Record<Hit["type"], string> = { archive: t("archives"), item: "Material", section: `${t("guide")} sections`, card: `${t("card")}s`, resource: "Links" };
  const counts = (hits ?? []).reduce<Partial<Record<Hit["type"], number>>>((m, h) => ({ ...m, [h.type]: (m[h.type] ?? 0) + 1 }), {});
  const kinds = (Object.keys(label) as Hit["type"][]).filter((k) => counts[k]);
  const shown = (hits ?? []).filter((h) => only === "all" || h.type === only);
  return (
    <div className="ulti-fade space-y-4">
      <h1 className="text-3xl">Search</h1>
      {!q && <p className="text-muted">Type something in the search box.</p>}
      {q && <p className="text-muted">{hits?.length ? `${hits.length} results for “${q}”` : `${copy("emptySearch")} (“${q}”)`}</p>}
      {kinds.length > 1 && (
        <div role="group" aria-label="Filter results" className="flex flex-wrap gap-2 text-sm">
          {(["all", ...kinds] as const).map((k) => (
            <button
              key={k}
              aria-pressed={only === k}
              onClick={() => setOnly(k)}
              className={`rounded-full border px-3 py-1 ${only === k ? "border-accent bg-surface text-ink" : "border-line text-muted hover:text-ink"}`}
            >
              {k === "all" ? `All ${hits?.length ?? 0}` : `${label[k]} ${counts[k]}`}
            </button>
          ))}
        </div>
      )}
      <ul className="divide-y divide-line rounded-md border border-line">
        {shown.map((h) => (
          <li key={`${h.type}-${h.id}`}>
            <Link href={h.type === "archive" ? `/archives/${h.id}` : h.type === "resource" ? `/archives/${h.archiveId}#resources` : `/items/${h.itemId}${h.anchor ? `#${h.anchor}` : ""}`} className="block p-3 hover:bg-surface">
              <span className="block">
                {h.title} <span className="text-xs text-muted">{h.type === "section" ? "guide section" : h.type === "item" ? "material" : h.type}</span>
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
        <Suspense fallback={<Loading />}>
          <Results />
        </Suspense>
      </Shell>
    </>
  );
}
