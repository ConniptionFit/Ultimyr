"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useNaming } from "@/lib/naming";
import type { StudyStats } from "@/lib/progress";

/** One quiet line on a course page when flashcards from that course are due, linking to a review of just that course. */
export function DueLink({ archive }: { archive: string }) {
  const { api } = useAuth();
  const { t } = useNaming();
  const [due, setDue] = useState(0);
  useEffect(() => {
    api<StudyStats>("GET", `study/stats?archive=${archive}`).then((s) => setDue(s.dueNow)).catch(() => setDue(0));
  }, [api, archive]);
  if (due === 0) return null;
  return (
    <p className="text-sm">
      <span className="text-muted">{due} {due === 1 ? "flashcard is" : "flashcards are"} due in this course. </span>
      <Link href={`/study?archive=${archive}`} className="text-accent underline">
        Start the {t("queue").toLowerCase()}
      </Link>
    </p>
  );
}
