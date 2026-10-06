"use client";

import { useEffect, useState } from "react";
import { Choice } from "@/components/display-panel";
import { Button } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { dailyReminderIcs } from "@/lib/ics";
import { withCurrent } from "@/lib/study-settings";

interface StudySettings {
  desiredRetention: number;
  newPerDay: number;
}

/** Settings: how many new flashcards a day and how sure you want to be of remembering. Saved to your account. */
export function StudyPanel() {
  const { api } = useAuth();
  const [s, setS] = useState<StudySettings | null>(null);
  const [msg, setMsg] = useState("");
  const [at, setAt] = useState("19:00");

  useEffect(() => {
    api<StudySettings>("GET", "study/settings").then(setS).catch(() => setMsg("Could not load your study settings."));
  }, [api]);

  async function save(patch: Partial<StudySettings>) {
    if (!s) return;
    const prev = s;
    setS({ ...s, ...patch });
    setMsg("");
    try {
      setS(await api<StudySettings>("PUT", "study/settings", patch));
      setMsg("Saved.");
    } catch {
      setS(prev);
      setMsg("Could not save. Try again.");
    }
  }

  return (
    <section className="space-y-5 border-t border-line pt-8" aria-label="Flashcard study">
      <div>
        <h2 className="text-xl">Flashcard study</h2>
        <p className="text-sm text-muted">Saved to your account, so it follows you to other devices.</p>
      </div>
      {s ? (
        <>
          <Choice<number>
            legend="New cards per day"
            hint="How many cards you have never seen are added to your daily review. Cards that are due always show first."
            value={s.newPerDay}
            onChange={(newPerDay) => save({ newPerDay })}
            options={withCurrent<number>([[0, "None"], [5, "5"], [10, "10"], [20, "20"], [40, "40"], [80, "80"]], s.newPerDay, String)}
          />
          <Choice<number>
            legend="How much you want to remember"
            hint="A higher target brings cards back sooner, so you review more often. 90% suits most people."
            value={s.desiredRetention}
            onChange={(desiredRetention) => save({ desiredRetention })}
            options={withCurrent<number>([[0.8, "80%"], [0.85, "85%"], [0.9, "90%"], [0.95, "95%"]], s.desiredRetention, (v) => `${Math.round(v * 100)}%`)}
          />
        </>
      ) : (
        !msg && <p className="text-sm text-muted">Loading</p>
      )}
      <div className="space-y-1">
        <p className="text-sm">Daily reminder</p>
        <p className="text-xs text-muted">Downloads a calendar entry that repeats every day, so your own calendar app can nudge you. Nothing is sent from here.</p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="remind-at">
            Reminder time
          </label>
          <input id="remind-at" type="time" value={at} onChange={(e) => setAt(e.target.value || "19:00")} className="rounded-md border border-line bg-surface px-3 py-1.5 text-ink" />
          <Button
            variant="quiet"
            onClick={() => {
              const url = URL.createObjectURL(new Blob([dailyReminderIcs(at, `${location.origin}/study`)], { type: "text/calendar;charset=utf-8" }));
              const a = document.createElement("a");
              a.href = url;
              a.download = "ultimyr-daily-review.ics";
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            Download calendar entry
          </Button>
        </div>
      </div>
      <p role="status" className="text-sm text-muted">
        {msg}
      </p>
    </section>
  );
}
