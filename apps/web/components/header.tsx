"use client";

import { Library, LogOut, Search, Settings } from "lucide-react";
import { UIcon } from "@ultimyr/ui-icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { useNaming } from "@/lib/naming";

export function Header() {
  const { state, signOut } = useAuth();
  const { t } = useNaming();
  const router = useRouter();
  return (
    <header className="border-b border-line">
      <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
        <Link href="/" className="flex items-center gap-2 font-serif text-lg">
          <UIcon icon={Library} size={20} />
          Ultimyr
        </Link>
        {state.status === "authenticated" && (
          <nav className="flex items-center gap-4 text-sm text-muted">
            <form
              role="search"
              onSubmit={(e) => {
                e.preventDefault();
                const q = String(new FormData(e.currentTarget).get("q") ?? "").trim();
                if (q) router.push(`/search?q=${encodeURIComponent(q)}`);
              }}
              className="flex items-center gap-1"
            >
              <UIcon icon={Search} size={14} aria-hidden />
              <input name="q" type="search" aria-label="Search" placeholder="Search" className="w-24 rounded border border-line bg-transparent px-2 py-0.5 text-ink focus:w-40" />
            </form>
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
