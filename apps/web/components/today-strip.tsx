"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useNaming } from "@/lib/naming";
import type { Analytics, StudyStats } from "@/lib/progress";

/** One quiet line on the Reading Room: cards due today and the streak. Hidden while there is nothing to say. */
export function TodayStrip() {
  const { api } = useAuth();
  const { t } = useNaming();
  const [due, setDue] = useState(0);
  const [reviewed, setReviewed] = useState(0);
  const [streak, setStreak] = useState(0);

  useEffect(() => {
    let live = true;
    api<StudyStats>("GET", "study/stats")
      .then((s) => live && (setDue(s.dueNow), setReviewed(s.reviewedToday)))
      .catch(() => undefined);
    api<Analytics>("GET", "analytics?days=7")
      .then((a) => live && setStreak(a.summary.streakDays))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [api]);

  // Show the count in the tab title too, so due cards are visible from another tab.
  useEffect(() => {
    if (!due) return;
    const base = document.title.replace(/^\(\d+\) /, "");
    document.title = `(${due}) ${base}`;
    return () => {
      document.title = base;
    };
  }, [due]);

  if (!due && !streak && !reviewed) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted" aria-label="Today">
      {due > 0 ? (
        <Link href="/study" className="text-accent underline">
          {due} {due === 1 ? "card" : "cards"} due in your {t("queue").toLowerCase()}
        </Link>
      ) : (
        <span>Nothing due{reviewed > 0 ? `, ${reviewed} reviewed today` : ""}.</span>
      )}
      {streak > 0 && (
        <span>
          {t("streak")}: {streak} {streak === 1 ? "day" : "days"}
        </span>
      )}
    </p>
  );
}
