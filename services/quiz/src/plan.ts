/**
 * The exam-day countdown plan: what to do each day from now to the exam, shaped by how many days are left.
 * Pure: pass in "today" and the person's numbers and the same plan comes back. It is a study schedule, not a prediction.
 */
export type PhaseId = "build" | "consolidate" | "sharpen" | "taper" | "exam";
export type TaskKind = "review" | "drill" | "practice_exam" | "light_review" | "checklist" | "exam";
export type ExamMode = "unknown" | "test_center" | "online";

export interface PlanInput {
  /** YYYY-MM-DD */
  today: string;
  examDate: string;
  readinessBp: number | null;
  targetBp: number | null;
  /** Weakest topics first, as written in the archive (domains). */
  weakAreas: string[];
  minutesPerDay: number;
  mode: ExamMode;
}

export interface PlanTask {
  kind: TaskKind;
  title: string;
  detail: string;
  minutes: number | null;
  /** For drills: which kind of drill to start. */
  focus?: "weak" | "missed";
}
export interface PlanDay {
  date: string;
  daysLeft: number;
  phase: PhaseId;
  tasks: PlanTask[];
}
export interface PlanPhase {
  id: PhaseId;
  label: string;
  /** Days left when the phase starts and ends (inclusive), counting down. */
  fromDaysLeft: number;
  toDaysLeft: number;
  summary: string;
}
export interface Plan {
  examDate: string;
  daysLeft: number;
  status: "upcoming" | "today" | "past";
  phase: PhaseId | null;
  phases: PlanPhase[];
  readiness: { bp: number | null; targetBp: number | null; gapBp: number | null };
  advice: string[];
  days: PlanDay[];
  /** True when the exam is further away than the days listed. */
  truncated: boolean;
  checklist: string[];
}

export const MAX_DAYS_LISTED = 28;
const DAY = 86_400_000;

export const PHASES: PlanPhase[] = [
  { id: "build", label: "Build", fromDaysLeft: 9999, toDaysLeft: 22, summary: "Cover everything. Daily flashcard review, a weak-area drill, and one full practice exam each week." },
  { id: "consolidate", label: "Consolidate", fromDaysLeft: 21, toDaysLeft: 8, summary: "Close gaps. Daily review and drills, a timed practice exam every third day, and a day to redo what you missed." },
  { id: "sharpen", label: "Sharpen", fromDaysLeft: 7, toDaysLeft: 3, summary: "Fix the last weak spots. Mostly missed questions, one final full practice exam, no new topics." },
  { id: "taper", label: "Taper", fromDaysLeft: 2, toDaysLeft: 1, summary: "Rest the brain. Short, light review only, and get everything ready for the day." },
  { id: "exam", label: "Exam day", fromDaysLeft: 0, toDaysLeft: 0, summary: "A light warm-up at most, then the exam." },
];

export const phaseFor = (daysLeft: number): PhaseId => (daysLeft >= 22 ? "build" : daysLeft >= 8 ? "consolidate" : daysLeft >= 3 ? "sharpen" : daysLeft >= 1 ? "taper" : "exam");

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
}
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const round5 = (n: number) => Math.max(5, Math.round(n / 5) * 5);
const pct = (bp: number) => `${Math.round(bp / 100)}%`;

export function examChecklist(mode: ExamMode): string[] {
  const common = [
    "Find your registration confirmation and voucher details, and keep them handy.",
    "Have valid photo ID ready. The name must match your registration.",
    "Read your provider's own exam-day instructions once more. They override anything here.",
    "Plan an early night, and eat and drink something before you start.",
  ];
  if (mode === "test_center") return [...common, "Plan your route and travel time, and note the arrival time in your confirmation.", "Expect to store personal items. Bring only what your confirmation allows."];
  if (mode === "online") return [...common, "Run your provider's system check on the same computer and network you will use.", "Clear your desk and room as your provider requires.", "Close other apps and turn off notifications before check-in."];
  return [...common, "Check whether you are testing at a centre or online, and prepare for that."];
}

/** `index` counts the weak-area drills already planned, so the topics take turns. */
function tasksFor(d: number, i: PlanInput, index: number): PlanTask[] {
  const m = Math.min(480, Math.max(15, i.minutesPerDay));
  const review: PlanTask = { kind: "review", title: "Daily flashcard review", detail: "Clear your due cards first. Cards you keep missing come back sooner.", minutes: round5(m * 0.35) };
  const weak = i.weakAreas.length ? i.weakAreas[index % i.weakAreas.length]! : null;
  const weakDrill = (): PlanTask => ({
    kind: "drill",
    title: weak ? `Weak-area drill: ${weak}` : "Weak-area drill",
    detail: weak ? `Questions built from what you miss most, starting with ${weak}.` : "Questions built from what you miss most. Take a few full practice quizzes first and this gets sharper.",
    minutes: round5(m * 0.65),
    focus: "weak",
  });
  const missedDrill = (minutes = round5(m * 0.65)): PlanTask => ({ kind: "drill", title: "Redo your misses", detail: "Questions you got wrong last time. Say why the right answer is right.", minutes, focus: "missed" });
  const exam = (title: string): PlanTask => ({ kind: "practice_exam", title, detail: "Timed, no help, as if it were the real thing. Then review every miss, including lucky guesses.", minutes: 90 });

  switch (phaseFor(d)) {
    case "build":
      return d % 7 === 0 ? [review, exam("Full-length practice exam")] : [review, weakDrill()];
    case "consolidate":
      if (d % 3 === 0) return [review, exam("Timed practice exam")];
      if ((d + 1) % 3 === 0 && d + 1 <= 21) return [review, missedDrill()];
      return [review, weakDrill()];
    case "sharpen":
      if (d === 5) return [review, exam("Final full practice exam")];
      if (d === 4) return [review, missedDrill()];
      if (d === 3) return [review, missedDrill(round5(m * 0.3))];
      return [review, weakDrill()];
    case "taper":
      return d === 2
        ? [{ kind: "light_review", title: "Light review only", detail: "Due flashcards and a skim of your notes. No new topics and no full practice exams.", minutes: 20 }]
        : [
            { kind: "light_review", title: "Short review, then stop", detail: "Fifteen minutes of due flashcards at most. You know what you know.", minutes: 15 },
            { kind: "checklist", title: "Get ready for tomorrow", detail: "Work through the exam-day checklist now, not in the morning.", minutes: null },
          ];
    case "exam":
      return [
        { kind: "light_review", title: "Optional 10 minute warm-up", detail: "A few easy flashcards if it calms you. Skip it if it does not.", minutes: 10 },
        { kind: "exam", title: "Your exam", detail: "Read each question twice, flag and move on when stuck, and keep an eye on the clock.", minutes: null },
      ];
  }
}

export function buildPlan(i: PlanInput): Plan {
  const daysLeft = daysBetween(i.today, i.examDate);
  const status = daysLeft < 0 ? "past" : daysLeft === 0 ? "today" : "upcoming";
  const gapBp = i.readinessBp !== null && i.targetBp !== null ? Math.max(0, i.targetBp - i.readinessBp) : null;

  const advice: string[] = [];
  if (status === "past") advice.push("The exam date has passed. Record the result in your credentials, or set a new date.");
  else {
    if (i.readinessBp === null) advice.push("Take at least 3 practice attempts to get a readiness estimate. The plan gets sharper with data.");
    else if (i.targetBp !== null && gapBp === 0) advice.push(`Your recent estimate (${pct(i.readinessBp)}) meets your target (${pct(i.targetBp)}). Hold it there with review, and avoid cramming new topics.`);
    else if (gapBp !== null && i.targetBp !== null) {
      advice.push(`Your recent estimate (${pct(i.readinessBp)}) is ${pct(gapBp)} points below your target (${pct(i.targetBp)}).`);
      if (daysLeft <= 7 && gapBp >= 1000) advice.push("With this few days left, consider whether a later date would suit you. Check your exam provider's rescheduling rules before deciding.");
    }
    if (daysLeft >= 1 && daysLeft <= 2) advice.push("Avoid new material now. Rest and recall beat last-minute cramming.");
  }

  const days: PlanDay[] = [];
  if (status !== "past") {
    const shown = Math.min(daysLeft, MAX_DAYS_LISTED - 1);
    let weakDrills = 0;
    for (let n = 0; n <= shown; n++) {
      const left = daysLeft - n;
      const tasks = tasksFor(left, i, weakDrills);
      weakDrills += tasks.filter((t) => t.focus === "weak").length;
      days.push({ date: addDays(i.today, n), daysLeft: left, phase: phaseFor(left), tasks });
    }
    // The exam day itself is always shown, however far off.
    if (daysLeft > shown) days.push({ date: i.examDate, daysLeft: 0, phase: "exam", tasks: tasksFor(0, i, 0) });
  }

  return {
    examDate: i.examDate,
    daysLeft,
    status,
    phase: status === "past" ? null : phaseFor(daysLeft),
    phases: PHASES,
    readiness: { bp: i.readinessBp, targetBp: i.targetBp, gapBp },
    advice,
    days,
    truncated: status === "upcoming" && daysLeft >= MAX_DAYS_LISTED,
    checklist: examChecklist(i.mode),
  };
}
