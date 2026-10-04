"use client";

import { Library, LogOut, Settings } from "lucide-react";
import { UIcon } from "@ultimyr/ui-icons";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { useNaming } from "@/lib/naming";

export function Header() {
  const { state, signOut } = useAuth();
  const { t } = useNaming();
  return (
    <header className="border-b border-line">
      <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
        <Link href="/" className="flex items-center gap-2 font-serif text-lg">
          <UIcon icon={Library} size={20} />
          Ultimyr
        </Link>
        {state.status === "authenticated" && (
          <nav className="flex items-center gap-4 text-sm text-muted">
            <Link href="/reading-room" className="hover:text-ink">
              {t("dashboard")}
            </Link>
            <Link href="/settings" className="flex items-center gap-1 hover:text-ink" aria-label="Settings">
              <UIcon icon={Settings} size={16} />
            </Link>
            <button
              className="flex items-center gap-1 hover:text-ink"
              onClick={async () => {
                await signOut();
                // Full navigation avoids racing the protected pages' redirect to /login.
                window.location.assign("/");
              }}
            >
              <UIcon icon={LogOut} size={16} />
              Sign out
            </button>
          </nav>
        )}
      </div>
    </header>
  );
}
