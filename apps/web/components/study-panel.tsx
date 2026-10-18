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
  leechSuspend: boolean;
}
interface Suspended {
  id: string;
  front: string;
  deck: string;
  course: string;
  lapses: number;
}

/** Settings: how many new flashcards a day and how sure you want to be of remembering. Saved to your account. */
export function StudyPanel() {
  const { api } = useAuth();
  const [s, setS] = useState<StudySettings | null>(null);
  const [msg, setMsg] = useState("");
  const [at, setAt] = useState("19:00");
  const [parked, setParked] = useState<Suspended[]>([]);
  const [load, setLoad] = useState<{ cards: number; options: { retention: number; reviewsPerDay: number }[] } | null>(null);

  useEffect(() => {
    api<StudySettings>("GET", "study/settings").then(setS).catch(() => setMsg("Could not load your study settings."));
    api<NonNullable<typeof load>>("GET", "study/workload").then(setLoad).catch(() => undefined);
    api<{ cards: Suspended[] }>("GET", "study/suspended").then((r) => setParked(r.cards)).catch(() => undefined);
  }, [api]);

  async function unsuspend(id: string) {
    try {
      await api("POST", `study/cards/${id}/suspend`, { suspended: false });
      setParked((l) => l.filter((c) => c.id !== id));
    } catch {
      setMsg("Could not bring that card back. Try again.");
    }
  }

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
          {load && load.cards >= 10 && (
            <p className="text-xs text-muted">
              For the {load.cards} cards you are learning now, that is about {load.options.map((o) => `${o.reviewsPerDay} reviews a day at ${Math.round(o.retention * 100)}%`).join(", ")}. New cards add to this.
            </p>
          )}
          <Choice<string>
            legend="Cards you keep forgetting"
            hint="A card you have forgotten 8 times is probably worded badly. Suspend it for you so it stops draining your reviews, then rewrite it or ask the author."
            value={s.leechSuspend ? "suspend" : "warn"}
            onChange={(v) => save({ leechSuspend: v === "suspend" })}
            options={[["warn", "Just warn me"], ["suspend", "Suspend it"]]}
          />
          {parked.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm">Suspended cards ({parked.length})</p>
              <ul className="space-y-1 text-sm">
                {parked.map((c) => (
                  <li key={c.id} className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate">
                      {c.front} <span className="text-xs text-muted">{c.course} · {c.deck}</span>
                    </span>
                    <button onClick={() => unsuspend(c.id)} className="shrink-0 text-accent underline">
                      Bring back
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
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
