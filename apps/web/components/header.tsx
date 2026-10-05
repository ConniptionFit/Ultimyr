"use client";

import { Library, Search } from "lucide-react";
import { UIcon } from "@ultimyr/ui-icons";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AccountMenu } from "@/components/account-menu";
import { MobileNav } from "@/components/mobile-nav";
import { PrepMenu } from "@/components/prep-menu";
import { useAuth } from "@/lib/auth";
import { useDisplay } from "@/lib/display";
import { useNaming } from "@/lib/naming";

export function Header() {
  const { state } = useAuth();
  const { t } = useNaming();
  const router = useRouter();
  const path = usePathname();
  const here = (href: string) => (path === href || path.startsWith(`${href}/`) ? ("page" as const) : undefined);
  const { focus, setFocus } = useDisplay();
  if (focus) {
    return (
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-3xl items-center justify-end px-4 py-2">
          <button className="text-sm text-muted hover:text-ink" onClick={() => setFocus(false)}>
            Leave focus mode
          </button>
        </div>
      </header>
    );
  }
  return (
    <header className="border-b border-line">
      <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
        <Link href={state.status === "authenticated" ? "/reading-room" : "/"} className="flex items-center gap-2 font-serif text-lg">
          <UIcon icon={Library} size={20} />
          Ultimyr
        </Link>
        {state.status === "authenticated" && (
          <>
          <div className="flex items-center gap-2 md:hidden">
            <Link href="/search" aria-label="Search" className="flex h-10 w-10 items-center justify-center rounded-md border border-line text-ink">
              <UIcon icon={Search} size={18} />
            </Link>
            <MobileNav />
          </div>
          <nav className="hidden items-center gap-4 text-sm text-muted md:flex">
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
            <Link href="/reading-room" aria-current={here("/reading-room")} className="hover:text-ink aria-[current=page]:text-ink aria-[current=page]:underline underline-offset-4">
              {t("dashboard")}
            </Link>
            <Link href="/study" aria-current={here("/study")} className="hover:text-ink aria-[current=page]:text-ink aria-[current=page]:underline underline-offset-4">
              {t("queue")}
            </Link>
            <Link href="/progress" aria-current={here("/progress")} className="hover:text-ink aria-[current=page]:text-ink aria-[current=page]:underline underline-offset-4">
              Progress
            </Link>
            <PrepMenu />
            <AccountMenu />
          </nav>
          </>
        )}
      </div>
    </header>
  );
}
