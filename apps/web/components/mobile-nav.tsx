"use client";

import { BarChart3, BookOpen, CalendarClock, Dumbbell, Layers, LogOut, Menu, Settings, ShieldCheck, Sparkles, X } from "lucide-react";
import { UIcon } from "@ultimyr/ui-icons";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useNaming } from "@/lib/naming";

/** Phone navigation: one menu button that opens a full-height sheet with every destination. Hidden from md up. */
export function MobileNav() {
  const { state, signOut } = useAuth();
  const { t } = useNaming();
  const path = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  if (state.status !== "authenticated") return null;
  const { user } = state;
  const isAdmin = user.roles.includes("platform_admin");
  const canOpenPanel = isAdmin || user.roles.includes("access_delegate");
  const row = "flex min-h-12 items-center gap-3 px-4 py-3 text-base text-ink active:bg-surface";
  const links = [
    { href: "/reading-room", icon: BookOpen, label: t("dashboard") },
    { href: "/study", icon: Layers, label: t("queue") },
    { href: "/progress", icon: BarChart3, label: "Progress" },
    { href: "/credentials", icon: ShieldCheck, label: t("credentials") },
    { href: "/drills", icon: Dumbbell, label: t("drills") },
    { href: "/exam-day", icon: CalendarClock, label: t("countdown") },
    { href: "/build", icon: Sparkles, label: t("build") },
  ];

  return (
    <div className="md:hidden">
      <button aria-label="Open menu" aria-expanded={open} onClick={() => setOpen(true)} className="flex h-10 w-10 items-center justify-center rounded-md border border-line text-ink">
        <UIcon icon={Menu} size={20} />
      </button>
      {open && (
        <div role="dialog" aria-modal="true" aria-label="Menu" className="fixed inset-0 z-40 flex flex-col overflow-y-auto bg-bg">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm text-ink">{user.displayName}</p>
              <p className="truncate text-xs text-muted">{user.email}</p>
            </div>
            <button aria-label="Close menu" onClick={() => setOpen(false)} className="flex h-10 w-10 items-center justify-center rounded-md border border-line text-ink">
              <UIcon icon={X} size={20} />
            </button>
          </div>
          <nav aria-label="Main" className="divide-y divide-line">
            {links.map((l) => (
              <Link key={l.href} href={l.href} className={row}>
                <UIcon icon={l.icon} size={18} /> {l.label}
              </Link>
            ))}
          </nav>
          <div className="mt-4 divide-y divide-line border-y border-line">
            <Link href="/settings" className={row}>
              <UIcon icon={Settings} size={18} /> Your settings
            </Link>
            {canOpenPanel && (
              <Link href={isAdmin ? "/admin" : "/admin/group-access"} className={row}>
                <UIcon icon={ShieldCheck} size={18} /> Admin panel
              </Link>
            )}
            <button
              className={`${row} w-full text-left`}
              onClick={async () => {
                await signOut();
                window.location.assign("/");
              }}
            >
              <UIcon icon={LogOut} size={18} /> Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
