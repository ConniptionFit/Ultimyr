"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Pane, SideNav } from "@/components/side-nav";
import { ADMIN_SECTIONS } from "@/lib/admin";
import { useNaming } from "@/lib/naming";
import { RequireSession } from "@/lib/require-session";

/** Admin panel: administrators only, category list on the left, General first. */
export default function AdminLayout({ children }: { children: ReactNode }) {
  const { t } = useNaming();
  const items = ADMIN_SECTIONS.map((s) => ({ href: s.href, label: s.term ? t(s.term) : s.label }));
  const path = usePathname().replace(/\/$/, "") || "/admin";
  return (
    <RequireSession admin wide>
      <Pane title="Admin panel" intro="Settings for the whole installation." nav={<SideNav label="Admin categories" items={items} current={path} />}>
        {children}
      </Pane>
    </RequireSession>
  );
}
