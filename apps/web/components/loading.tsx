"use client";

import { StatusIcon } from "@ultimyr/ui-icons";
import { useNaming } from "@/lib/naming";

/** The page loading state: the animated icon plus words, announced politely to screen readers. */
export function Loading() {
  const { copy } = useNaming();
  return (
    <p role="status" className="flex items-center gap-2 text-sm text-muted">
      <StatusIcon status="loading" size={22} />
      <span>{copy("loading")}</span>
    </p>
  );
}
