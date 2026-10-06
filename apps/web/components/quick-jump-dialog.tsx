"use client";

import { Search } from "lucide-react";
import { UIcon } from "@ultimyr/ui-icons";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useDialog } from "@/lib/focus-trap";
import { useNaming } from "@/lib/naming";
import { rankJump, type JumpEntry } from "@/lib/quick-jump";
import type { Archive } from "@/lib/types";

/** Ctrl/Cmd+K: type part of a page or course name, press Enter. Courses load when the box first opens. */
export default function QuickJumpDialog({ onClose }: { onClose: () => void }) {
  const { t } = useNaming();
  const { api, state } = useAuth();
  const router = useRouter();
  const box = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [archives, setArchives] = useState<Archive[]>([]);
  useDialog(box, true, onClose);

  useEffect(() => {
    api<{ archives: Archive[] }>("GET", "archives").then((r) => setArchives(r.archives)).catch(() => {});
  }, [api]);

  const entries = useMemo<JumpEntry[]>(() => {
    const roles = state.status === "authenticated" ? state.user.roles : [];
    const pages: JumpEntry[] = [
      { id: "p-room", label: t("dashboard"), hint: "Page", href: "/reading-room", keywords: "home courses" },
      { id: "p-study", label: t("queue"), hint: "Page", href: "/study", keywords: "flashcards review due" },
      { id: "p-progress", label: "Progress", hint: "Page", href: "/progress", keywords: "stats streak" },
      { id: "p-cred", label: t("credentials"), hint: t("prep"), href: "/credentials", keywords: "voucher renewal certificate" },
      { id: "p-drills", label: t("drills"), hint: t("prep"), href: "/drills", keywords: "practice weak" },
      { id: "p-exam", label: t("countdown"), hint: t("prep"), href: "/exam-day", keywords: "plan date schedule" },
      { id: "p-build", label: t("build"), hint: t("prep"), href: "/build", keywords: "create import ai" },
      { id: "p-search", label: "Search", hint: "Page", href: "/search" },
      { id: "p-settings", label: "Settings", hint: "Your account", href: "/settings", keywords: "account password display naming" },
    ];
    if (roles.includes("platform_admin") || roles.includes("curriculum_admin")) {
      pages.push({ id: "p-admin", label: t("admin"), hint: "Page", href: roles.includes("platform_admin") ? "/admin" : "/admin/group-access", keywords: "users panel" });
    }
    const courses = archives.map((a) => ({ id: `a-${a.id}`, label: a.title, hint: a.vendor ?? t("archive"), href: `/archives/${a.id}` }));
    return [...pages, ...courses];
  }, [archives, state, t]);

  const results = useMemo(() => rankJump(entries, query), [entries, query]);
  const q = query.trim();

  // Guides, decks and quizzes by title, from the search service once two letters are typed.
  const [material, setMaterial] = useState<{ q: string; rows: JumpEntry[] }>({ q: "", rows: [] });
  useEffect(() => {
    if (q.length < 2) return;
    let live = true;
    const timer = setTimeout(() => {
      api<{ results: { type: string; id: string; itemId: string | null; title: string }[] }>("GET", `search?q=${encodeURIComponent(q)}&type=item&limit=5`)
        .then((r) => {
          const rows = r.results
            .filter((h) => h.type === "item")
            .slice(0, 5)
            .map((h) => ({ id: `i-${h.id}`, label: h.title, hint: "Material", href: `/items/${h.itemId ?? h.id}` }));
          if (live) setMaterial({ q, rows });
        })
        .catch(() => {});
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [api, q]);
  const found = material.q === q ? material.rows : [];

  const rows: JumpEntry[] = q ? [...results, ...found, { id: "q-search", label: `Search everything for “${q}”`, href: `/search?q=${encodeURIComponent(q)}` }] : results;
  const at = Math.min(active, rows.length - 1);

  function go(e: JumpEntry | undefined) {
    if (!e) return;
    onClose();
    router.push(e.href);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[12vh]" onClick={onClose}>
      <div ref={box} role="dialog" aria-modal="true" aria-label={t("quickJump")} onClick={(e) => e.stopPropagation()} className="w-full max-w-lg overflow-hidden rounded-lg border border-line bg-bg shadow-lg">
        <div className="flex items-center gap-2 border-b border-line px-3">
          <UIcon icon={Search} size={16} aria-hidden />
          <input
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls="jump-list"
            aria-activedescendant={rows[at] ? `jump-${rows[at]!.id}` : undefined}
            aria-label="Go to a page, course or material"
            placeholder="Go to a page, course or material"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((at + 1) % rows.length);
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((at - 1 + rows.length) % rows.length);
              } else if (e.key === "Enter") {
                e.preventDefault();
                go(rows[at]);
              }
            }}
            className="w-full bg-transparent py-3 text-ink outline-none"
          />
        </div>
        <ul id="jump-list" role="listbox" aria-label="Matches" className="max-h-72 overflow-y-auto py-1">
          {rows.map((r, i) => (
            <li
              key={r.id}
              id={`jump-${r.id}`}
              role="option"
              aria-selected={i === at}
              onMouseEnter={() => setActive(i)}
              onClick={() => go(r)}
              className={`flex cursor-pointer items-baseline justify-between gap-3 px-3 py-2 text-sm ${i === at ? "bg-surface text-ink" : "text-muted"}`}
            >
              <span className="truncate">{r.label}</span>
              {r.hint && <span className="shrink-0 text-xs text-muted">{r.hint}</span>}
            </li>
          ))}
        </ul>
        <p className="border-t border-line px-3 py-1.5 text-xs text-muted">Up and down to choose, Enter to go, Esc to close.</p>
      </div>
    </div>
  );
}
