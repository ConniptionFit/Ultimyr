import Link from "next/link";
import type { ReactNode } from "react";

export interface NavItem {
  href: string;
  label: string;
  hint?: string;
}

/** Left-hand category list shared by the settings and admin panes. Collapses to a wrapped row on phones. */
export function SideNav({ label, items, current }: { label: string; items: NavItem[]; current: string }) {
  return (
    <nav aria-label={label} className="md:w-48 md:shrink-0">
      <ul className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 md:mx-0 md:sticky md:top-6 md:flex-col md:overflow-visible md:px-0 md:pb-0">
        {items.map((i) => {
          const active = i.href === current;
          return (
            <li key={i.href}>
              <Link
                href={i.href}
                aria-current={active ? "page" : undefined}
                className={`block whitespace-nowrap rounded-md px-3 py-1.5 text-sm ${active ? "bg-surface text-ink ring-1 ring-line" : "text-muted hover:text-ink"}`}
              >
                {i.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function Pane({ title, intro, nav, children }: { title: string; intro?: string; nav: ReactNode; children: ReactNode }) {
  return (
    <div className="ulti-fade space-y-8">
      <div>
        <h1 className="text-3xl">{title}</h1>
        {intro && <p className="mt-1 text-sm text-muted">{intro}</p>}
      </div>
      <div className="flex flex-col gap-8 md:flex-row">
        {nav}
        <div className="min-w-0 flex-1 space-y-8">{children}</div>
      </div>
    </div>
  );
}
