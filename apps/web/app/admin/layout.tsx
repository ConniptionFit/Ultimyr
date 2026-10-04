"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Pane, SideNav } from "@/components/side-nav";
import { ADMIN_SECTIONS } from "@/lib/admin";
import { RequireSession } from "@/lib/require-session";

/** Admin panel: administrators only, category list on the left, General first. */
export default function AdminLayout({ children }: { children: ReactNode }) {
  const path = usePathname().replace(/\/$/, "") || "/admin";
  return (
    <RequireSession admin wide>
      <Pane title="Admin panel" intro="Settings for the whole installation." nav={<SideNav label="Admin categories" items={ADMIN_SECTIONS} current={path} />}>
        {children}
      </Pane>
    </RequireSession>
  );
}
