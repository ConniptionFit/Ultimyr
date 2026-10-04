"use client";

import { LogOut, Settings, ShieldCheck, UserRound } from "lucide-react";
import { UIcon } from "@ultimyr/ui-icons";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";

/** The account icon in the menu bar. Everything that affects only your own session lives behind it. */
export function AccountMenu() {
  const { state, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (state.status !== "authenticated") return null;
  const { user } = state;
  const isAdmin = user.roles.includes("platform_admin");
  const item = "flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink hover:bg-bg";

  return (
    <div ref={root} className="relative">
      <button
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 w-8 items-center justify-center rounded-full border border-line hover:text-ink"
      >
        <UIcon icon={UserRound} size={16} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-2 w-60 overflow-hidden rounded-md border border-line bg-surface shadow-lg">
          <div className="border-b border-line px-3 py-2">
            <p className="truncate text-sm text-ink">{user.displayName}</p>
            <p className="truncate text-xs text-muted">{user.email}</p>
          </div>
          <Link role="menuitem" href="/settings" className={item} onClick={() => setOpen(false)}>
            <UIcon icon={Settings} size={16} /> Your settings
          </Link>
          {isAdmin && (
            <Link role="menuitem" href="/admin" className={item} onClick={() => setOpen(false)}>
              <UIcon icon={ShieldCheck} size={16} /> Admin panel
            </Link>
          )}
          <button
            role="menuitem"
            className={`${item} border-t border-line`}
            onClick={async () => {
              await signOut();
              // Full navigation avoids racing the protected pages' redirect to /login.
              window.location.assign("/");
            }}
          >
            <UIcon icon={LogOut} size={16} /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}
