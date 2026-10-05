"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Pane, SideNav } from "@/components/side-nav";
import { ADMIN_SECTIONS } from "@/lib/admin";
import { useNaming } from "@/lib/naming";
import { useAuth } from "@/lib/auth";
import { RequireSession } from "@/lib/require-session";

/**
 * Admin panel: administrators only, category list on the left, General first. People who only hold the
 * access_delegate role see just Group access; the server checks every call regardless.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  const { t } = useNaming();
  const { state } = useAuth();
  const delegateOnly = state.status === "authenticated" && !state.user.roles.includes("platform_admin");
  const items = ADMIN_SECTIONS.filter((s) => !delegateOnly || s.delegate).map((s) => ({ href: s.href, label: s.term ? t(s.term) : s.label }));
  const path = usePathname().replace(/\/$/, "") || "/admin";
  const allowed = !delegateOnly || ADMIN_SECTIONS.some((s) => s.delegate && s.href === path);
  return (
    <RequireSession admin delegate wide>
      <Pane
        title={delegateOnly ? t("groupAccess") : "Admin panel"}
        intro={delegateOnly ? "Choose which groups can use the courses delegated to you." : "Settings for the whole installation."}
        nav={<SideNav label="Admin categories" items={items} current={path} />}
      >
        {allowed ? children : <p className="text-sm text-muted">This page is only open to administrators.</p>}
      </Pane>
    </RequireSession>
  );
}
