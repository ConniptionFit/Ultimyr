"use client";

import { CalendarClock, Dumbbell, Layers, ListChecks, Printer, Timer } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Loading } from "@/components/loading";
import { Button, Field } from "@/components/ui";
import { ApiError, useAuth } from "@/lib/auth";
import { MODE_LABEL, daysText, formatDay, formatDayShort, todayIso, type Credential, type Plan, type PlanDay, type PlanTask } from "@/lib/certs";
import { useNaming } from "@/lib/naming";
import { pct } from "@/lib/quiz";
import { RequireSession } from "@/lib/require-session";
import type { Archive } from "@/lib/types";

const input = "w-full rounded-md border border-line bg-surface px-3 py-2 text-ink";
const MINUTES = [30, 45, 60, 90, 120];
const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Private mode or blocked storage: the page works, it just forgets.
    }
  },
};

function ExamDay() {
  const { api } = useAuth();
  const { t } = useNaming();
  const params = useSearchParams();
  const credentialId = params.get("credential");
  const [credential, setCredential] = useState<Credential | null>(null);
  const [archives, setArchives] = useState<Archive[]>([]);
  const [archiveId, setArchiveId] = useState(params.get("archive") ?? "");
  const [date, setDate] = useState(params.get("date") ?? "");
  const [minutes, setMinutes] = useState(() => Number(store.get("ultimyr_plan_minutes")) || 45);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // Resolve what to plan for: a credential, or an archive and a date typed here.
  useEffect(() => {
    (async () => {
      const list = await api<{ archives: Archive[] }>("GET", "archives").catch(() => ({ archives: [] as Archive[] }));
      setArchives(list.archives);
      // With a single course there is nothing to choose.
      if (!credentialId && list.archives.length === 1) setArchiveId((cur) => cur || list.archives[0]!.id);
      if (credentialId) {
        try {
          const c = await api<Credential>("GET", `credentials/${credentialId}`);
          setCredential(c);
          if (c.archiveId) setArchiveId(c.archiveId);
          if (c.examDate) setDate(c.examDate);
        } catch {
          setError("Could not find that credential.");
        }
      }
      setReady(true);
    })();
  }, [api, credentialId]);

  // No date yet: use the exam date saved with this course's goal on Progress, if there is one.
  useEffect(() => {
    if (!ready || !archiveId || date) return;
    let live = true;
    api<{ goal: { targetDate: string | null } | null }>("GET", `analytics?archive=${archiveId}&days=1`)
      .then((a) => live && a.goal?.targetDate && setDate(a.goal.targetDate))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [api, ready, archiveId, date]);

  const load = useCallback(async () => {
    if (!archiveId) return;
    setError(null);
    try {
      const q = new URLSearchParams({ archive: archiveId, minutes: String(minutes), mode: credential?.examMode ?? "unknown", today: todayIso() });
      if (date) q.set("examDate", date);
      setPlan(await api<Plan>("GET", `plan?${q}`));
    } catch (e) {
      setPlan(null);
      setError(e instanceof ApiError && e.status === 400 ? "Add an exam date to see your plan." : "Could not build the plan.");
    }
  }, [api, archiveId, date, minutes, credential?.examMode]);
  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  if (!ready) return <Loading />;

  const picker = (
    <form
      key={`${archiveId}|${date}`}
      onSubmit={(e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setArchiveId(String(f.get("archive")));
        setDate(String(f.get("date")));
      }}
      className="grid items-end gap-3 rounded-md border border-line p-4 sm:grid-cols-[1fr_12rem_auto]"
    >
      <div className="space-y-1">
        <label htmlFor="ed-archive" className="text-sm text-muted">
          Course
        </label>
        <select id="ed-archive" name="archive" defaultValue={archiveId} className={input} required>
          <option value="" disabled>
            Choose one
          </option>
          {archives.map((a) => (
            <option key={a.id} value={a.id}>
              {a.title}
            </option>
          ))}
        </select>
      </div>
      <Field id="ed-date" name="date" type="date" label="Exam date" defaultValue={date} min={todayIso()} />
      <Button type="submit">Plan</Button>
    </form>
  );

  return (
    <div className="ulti-fade space-y-8">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-3xl">
            <CalendarClock aria-hidden /> {t("countdown")}
          </h1>
          <p className="mt-1 text-sm text-muted">{credential ? credential.name : "A day-by-day plan to your exam date, shaped by how many days are left and how you are scoring."}</p>
        </div>
        {plan && (
          <Button variant="quiet" className="no-print shrink-0" onClick={() => window.print()} title="Print or save the plan as PDF">
            <Printer size={16} aria-hidden /> Print
          </Button>
        )}
      </div>
      {!credentialId && <div className="no-print">{picker}</div>}
      {error && (
        <p role={error.startsWith("Add an exam date") ? "status" : "alert"} className={`text-sm ${error.startsWith("Add an exam date") ? "text-muted" : "text-danger"}`}>
          {error}
        </p>
      )}
      {plan && <PlanView plan={plan} credential={credential} archiveId={archiveId} minutes={minutes} setMinutes={(m) => (setMinutes(m), store.set("ultimyr_plan_minutes", String(m)))} />}
    </div>
  );
}

function PlanView({ plan, credential, archiveId, minutes, setMinutes }: { plan: Plan; credential: Credential | null; archiveId: string; minutes: number; setMinutes: (m: number) => void }) {
  const today = plan.days[0];
  const rest = plan.days.slice(1);
  const hero = plan.status === "today" ? "Today" : plan.status === "past" ? "Passed" : String(plan.daysLeft);
  return (
    <>
      <section aria-labelledby="count-h" className="space-y-3 rounded-md border border-line p-5">
        <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
          <p className="text-6xl tabular-nums" id="count-h">
            {hero}
          </p>
          <div className="pb-2 text-sm">
            {plan.status === "upcoming" && <p>{plan.daysLeft === 1 ? "day to go" : "days to go"}</p>}
            <p className="text-muted">
              {formatDay(plan.examDate)}
              {credential?.examTime ? ` at ${credential.examTime}` : ""}
              {plan.usedGoalDate ? " (your goal date)" : ""}
            </p>
          </div>
        </div>
        {plan.status === "upcoming" && (
          <ol className="flex flex-wrap gap-2 text-xs" aria-label="Phases">
            {plan.phases.map((p) => (
              <li key={p.id} aria-current={p.id === plan.phase ? "step" : undefined} className={`rounded-full border px-3 py-1 ${p.id === plan.phase ? "border-accent text-accent" : "border-line text-muted"}`}>
                {p.label}
              </li>
            ))}
          </ol>
        )}
        {plan.phase && <p className="text-sm text-muted">{plan.phases.find((p) => p.id === plan.phase)?.summary}</p>}
        {plan.readiness.bp !== null && (
          <p className="text-sm">
            Readiness estimate {pct(plan.readiness.bp)}
            {plan.readiness.targetBp !== null ? `, target ${pct(plan.readiness.targetBp)}` : ""}.
          </p>
        )}
      </section>

      {plan.advice.length > 0 && (
        <ul className="space-y-1 text-sm">
          {plan.advice.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      )}

      {today && (
        <section aria-labelledby="today-h" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="today-h" className="text-xl">
              Today
            </h2>
            <label className="flex items-center gap-2 text-sm text-muted">
              Time I have
              <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className="rounded-md border border-line bg-surface px-2 py-1 text-ink">
                {MINUTES.map((m) => (
                  <option key={m} value={m}>
                    {m} min
                  </option>
                ))}
              </select>
            </label>
          </div>
          <TaskList day={today} archiveId={archiveId} />
        </section>
      )}

      <Checklist plan={plan} credential={credential} archiveId={archiveId} />

      {rest.length > 0 && (
        <section aria-labelledby="next-h" className="space-y-3">
          <h2 id="next-h" className="text-xl">
            The days ahead
          </h2>
          <ol className="space-y-2">
            {rest.map((d) => (
              <li key={d.date}>
                <details className="rounded-md border border-line px-4 py-2">
                  <summary className="cursor-pointer text-sm">
                    <span className="inline-block w-28">{formatDayShort(d.date)}</span>
                    <span className="text-muted">
                      {plan.phases.find((p) => p.id === d.phase)?.label}, {d.daysLeft === 0 ? "exam day" : daysText(d.daysLeft)} · {d.tasks.map((t) => t.title).join(", ")}
                    </span>
                  </summary>
                  <div className="mt-3">
                    <TaskList day={d} archiveId={archiveId} />
                  </div>
                </details>
              </li>
            ))}
          </ol>
          {plan.truncated && <p className="text-sm text-muted">Showing the next four weeks and exam day. The plan fills in as the date gets closer.</p>}
        </section>
      )}
    </>
  );
}

const TASK_ICON: Record<PlanTask["kind"], typeof Layers> = { review: Layers, drill: Dumbbell, practice_exam: Timer, light_review: Layers, checklist: ListChecks, exam: CalendarClock };

function TaskList({ day, archiveId }: { day: PlanDay; archiveId: string }) {
  return (
    <ul className="space-y-2">
      {day.tasks.map((t) => {
        const Icon = TASK_ICON[t.kind];
        const href =
          t.kind === "review" || t.kind === "light_review" ? `/study?archive=${archiveId}` : t.kind === "drill" ? `/drills?archive=${archiveId}&focus=${t.focus ?? "mixed"}` : t.kind === "practice_exam" ? `/archives/${archiveId}` : null;
        return (
          <li key={t.title} className="flex items-start gap-3 rounded-md border border-line p-3">
            <span className="mt-0.5 text-accent">
              <Icon size={18} aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">
                {t.title}
                {t.minutes ? <span className="ml-2 font-normal text-muted">about {t.minutes} min</span> : null}
              </p>
              <p className="text-sm text-muted">{t.detail}</p>
            </div>
            {href && (
              <Link href={href} className="shrink-0 text-sm text-accent underline">
                {t.kind === "practice_exam" ? "Open course" : "Start"}
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Exam-day checklist. Tick-offs are remembered in this browser only. */
function Checklist({ plan, credential, archiveId }: { plan: Plan; credential: Credential | null; archiveId: string }) {
  const key = `ultimyr_examday_${archiveId}_${plan.examDate}`;
  const [done, setDone] = useState<string[]>([]);
  useEffect(() => {
    try {
      setDone(JSON.parse(store.get(key) ?? "[]") as string[]);
    } catch {
      setDone([]);
    }
  }, [key]);
  const toggle = (item: string, on: boolean) => {
    const next = on ? [...done, item] : done.filter((x) => x !== item);
    setDone(next);
    store.set(key, JSON.stringify(next));
  };
  const items = useMemo(() => plan.checklist, [plan.checklist]);
  if (plan.status === "past") return null;
  return (
    <section aria-labelledby="check-h" className="space-y-3">
      <h2 id="check-h" className="text-xl">
        Exam-day checklist
      </h2>
      {credential && (credential.examLocation || credential.voucherCode || credential.examMode !== "unknown") && (
        <dl className="space-y-1 rounded-md border border-line p-3 text-sm">
          {credential.examMode !== "unknown" && (
            <div className="flex gap-2">
              <dt className="w-20 shrink-0 text-muted">Format</dt>
              <dd>{MODE_LABEL[credential.examMode]}</dd>
            </div>
          )}
          {credential.examLocation && (
            <div className="flex gap-2">
              <dt className="w-20 shrink-0 text-muted">Where</dt>
              <dd>{credential.examLocation}</dd>
            </div>
          )}
          {credential.voucherCode && (
            <div className="flex gap-2">
              <dt className="w-20 shrink-0 text-muted">Voucher</dt>
              <dd>
                <code>{credential.voucherCode}</code>
              </dd>
            </div>
          )}
        </dl>
      )}
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item}>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={done.includes(item)} onChange={(e) => toggle(item, e.target.checked)} />
              <span className={done.includes(item) ? "text-muted line-through" : ""}>{item}</span>
            </label>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted">This is a general list. Your exam provider&apos;s own instructions always come first.</p>
    </section>
  );
}

export default function ExamDayPage() {
  return (
    <RequireSession>
      <Suspense fallback={<Loading />}>
        <ExamDay />
      </Suspense>
    </RequireSession>
  );
}
