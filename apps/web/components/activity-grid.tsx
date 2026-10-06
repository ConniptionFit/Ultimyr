"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth";
import { buildGrid, gridSpanDays } from "@/lib/activity-grid";
import type { Analytics } from "@/lib/progress";

const WEEKS = 12;
const LEVEL_OPACITY = [0.08, 0.3, 0.5, 0.75, 1];

/** A calendar of the last 12 weeks: each square is a day, darker when you studied more (flashcard reviews plus quiz attempts). */
export function ActivityGrid({ archive }: { archive: string }) {
  const { api } = useAuth();
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const today = useMemo(() => new Date(), []);

  useEffect(() => {
    const span = gridSpanDays(today, WEEKS);
    const qs = archive ? `archive=${archive}&` : "";
    Promise.all([
      api<{ activity: { date: string; reviews: number }[] }>("GET", `study/activity?${qs}days=${span}`).catch(() => ({ activity: [] })),
      api<Analytics>("GET", `analytics?${qs}days=${Math.min(365, span)}`).catch(() => null),
    ]).then(([reviews, quiz]) => {
      const c: Record<string, number> = {};
      for (const r of reviews.activity) c[r.date] = (c[r.date] ?? 0) + r.reviews;
      for (const d of quiz?.daily ?? []) c[d.date] = (c[d.date] ?? 0) + d.attempts;
      setCounts(c);
    });
  }, [api, archive, today]);

  const grid = useMemo(() => buildGrid(today, counts ?? {}, WEEKS), [today, counts]);
  if (!counts) return null;
  const days = grid.flat().filter((d): d is NonNullable<typeof d> => d !== null);
  const active = days.filter((d) => d.count > 0).length;
  const cell = 11;
  const gap = 3;
  const size = cell + gap;
  return (
    <section aria-labelledby="act-h" className="space-y-2">
      <h2 id="act-h" className="text-xl">
        Study days
      </h2>
      <p className="text-sm text-muted">
        {active === 0 ? "No study yet in the last 12 weeks." : `You studied on ${active} of the last ${days.length} days.`} Reviews and quiz attempts both count.
      </p>
      <figure>
        <svg viewBox={`0 0 ${WEEKS * size} ${7 * size}`} role="img" aria-label={`Study activity for the last ${days.length} days. ${active} days with study.`} style={{ width: "100%", maxWidth: 24 * 12 + "px", height: "auto" }}>
          {grid.map((col, w) =>
            col.map((d, i) =>
              d ? (
                <rect key={d.date} x={w * size} y={i * size} width={cell} height={cell} rx={2} fill="var(--accent)" opacity={LEVEL_OPACITY[d.level]}>
                  <title>{`${d.date}: ${d.count} ${d.count === 1 ? "activity" : "activities"}`}</title>
                </rect>
              ) : null,
            ),
          )}
        </svg>
        <figcaption className="sr-only">{days.filter((d) => d.count > 0).map((d) => `${d.date}: ${d.count}`).join(", ")}</figcaption>
      </figure>
    </section>
  );
}
