"use client";

import { useEffect, useState } from "react";
import { CatalogIcon } from "@/components/catalog-icon";
import { useAuth } from "@/lib/auth";
import { ICONS } from "@/lib/icons";
import type { Archive } from "@/lib/types";

export const AUTO_ICON = "__auto__";

interface Found {
  name: string;
}

/**
 * Icon choices for an archive, as radio buttons named "icon" inside the surrounding form. "Choose for me" hands the icon
 * to automatic assignment from the archive's tags; any other pick is the person's own and is never replaced automatically.
 */
export function IconPicker({ archiveId, icon }: { archiveId: string; icon: Archive["icon"] }) {
  const { api } = useAuth();
  const [suggested, setSuggested] = useState<string[]>([]);
  const [found, setFound] = useState<string[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    api<{ suggestions: Array<{ name: string }> }>("GET", `archives/${archiveId}/icon-suggestions?limit=8`)
      .then((r) => setSuggested(r.suggestions.map((s) => s.name)))
      .catch(() => setSuggested([]));
  }, [api, archiveId]);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setFound([]);
      return;
    }
    const t = setTimeout(() => {
      api<{ icons: Found[] }>("GET", `icons?query=${encodeURIComponent(q)}&limit=36`)
        .then((r) => setFound(r.icons.map((i) => i.name)))
        .catch(() => setFound([]));
    }, 250);
    return () => clearTimeout(t);
  }, [api, query]);

  const isUser = icon.kind === "lucide" && icon.source === "user";
  const chosen = icon.kind === "lucide" && isUser ? icon.name : null;
  const common = Object.keys(ICONS);
  const shown = [...new Set([...(chosen ? [chosen] : []), ...suggested, ...common])];

  const swatch = (name: string, checked?: boolean) => (
    <label key={name} title={name} className="cursor-pointer rounded-md border border-line p-2 has-[:checked]:border-accent has-[:checked]:text-accent">
      <input type="radio" name="icon" value={name} defaultChecked={checked ?? chosen === name} className="sr-only" />
      <CatalogIcon name={name} size={20} aria-label={name} />
    </label>
  );

  return (
    <div className="space-y-3">
      <label className="flex cursor-pointer items-start gap-2 text-sm">
        <input type="radio" name="icon" value={AUTO_ICON} defaultChecked={icon.kind === "lucide" && !isUser} className="mt-1" />
        <span>
          Choose for me
          <span className="block text-muted">Picked from this course&apos;s tags (what it covers and what kind of material it is). Your own choice below is never replaced.</span>
        </span>
      </label>
      {suggested.length > 0 && <p className="text-xs text-muted">Suggested first, then common icons.</p>}
      <div className="flex flex-wrap gap-2">{shown.map((n) => swatch(n))}</div>
      <label className="block text-sm text-muted">
        Search every icon
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="robot, shield, database" className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 text-ink" />
      </label>
      {found.length > 0 && <div className="flex flex-wrap gap-2">{found.filter((n) => !shown.includes(n)).map((n) => swatch(n, false))}</div>}
    </div>
  );
}
