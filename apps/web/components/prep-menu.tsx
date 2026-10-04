"use client";

import { CalendarClock, ChevronDown, Dumbbell, ShieldCheck, Sparkles } from "lucide-react";
import { UIcon } from "@ultimyr/ui-icons";
import Link from "next/link";
import { useNaming } from "@/lib/naming";
import { useEffect, useRef, useState } from "react";

/** Exam preparation: credentials and renewals, weak-area drills, and the countdown plan. */
export function PrepMenu() {
  const { t } = useNaming();
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

  const item = "flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink hover:bg-bg";
  return (
    <div ref={root} className="relative">
      <button aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 hover:text-ink">
        {t("prep")} <UIcon icon={ChevronDown} size={14} aria-hidden />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-2 w-64 overflow-hidden rounded-md border border-line bg-surface shadow-lg">
          <Link role="menuitem" href="/credentials" className={item} onClick={() => setOpen(false)}>
            <UIcon icon={ShieldCheck} size={16} /> {t("credentials")}
          </Link>
          <Link role="menuitem" href="/drills" className={item} onClick={() => setOpen(false)}>
            <UIcon icon={Dumbbell} size={16} /> {t("drills")}
          </Link>
          <Link role="menuitem" href="/exam-day" className={item} onClick={() => setOpen(false)}>
            <UIcon icon={CalendarClock} size={16} /> {t("countdown")}
          </Link>
          <Link role="menuitem" href="/build" className={item} onClick={() => setOpen(false)}>
            <UIcon icon={Sparkles} size={16} /> {t("build")}
          </Link>
        </div>
      )}
    </div>
  );
}
