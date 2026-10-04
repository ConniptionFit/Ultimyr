/** Renewal and exam reminders, worked out from a person's own dates. Pure: pass in "today" and get the same answer every time. */
export type AlertKind = "exam_today" | "exam_soon" | "exam_past" | "voucher_expiring" | "voucher_expired" | "renewal_due" | "expired" | "ceu_short";
export type Severity = "info" | "warn" | "urgent";

export interface AlertInput {
  id: string;
  name: string;
  status: "planned" | "scheduled" | "earned" | "retired";
  examDate: string | null;
  voucherCode: string;
  voucherExpires: string | null;
  earnedOn: string | null;
  expiresOn: string | null;
  renewalAlertDays: number;
  ceuRequired: number | null;
  ceuUnit: string;
  /** Units logged inside the current renewal cycle. */
  ceuLogged: number;
}

export interface Alert {
  credentialId: string;
  credentialName: string;
  kind: AlertKind;
  severity: Severity;
  /** The date the alert is about, as YYYY-MM-DD. */
  date: string | null;
  daysLeft: number | null;
  message: string;
}

const DAY = 86_400_000;
const rank: Record<Severity, number> = { urgent: 0, warn: 1, info: 2 };

/** Whole days from `today` to `date` (negative when it has passed). Both are YYYY-MM-DD, compared as UTC dates. */
export function daysUntil(date: string, today: string): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY);
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const when = (d: number) => (d === 0 ? "today" : d === 1 ? "tomorrow" : `in ${plural(d, "day")}`);
const ago = (d: number) => (d === -1 ? "yesterday" : `${plural(-d, "day")} ago`);
const units = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, ""));

export function computeAlerts(creds: AlertInput[], today: string): Alert[] {
  const out: Alert[] = [];
  for (const c of creds) {
    if (c.status === "retired") continue;
    const push = (kind: AlertKind, severity: Severity, date: string | null, message: string) =>
      out.push({ credentialId: c.id, credentialName: c.name, kind, severity, date, daysLeft: date ? daysUntil(date, today) : null, message });

    if (c.status === "planned" || c.status === "scheduled") {
      if (c.examDate) {
        const d = daysUntil(c.examDate, today);
        if (d === 0) push("exam_today", "urgent", c.examDate, `${c.name}: your exam is today.`);
        else if (d > 0 && d <= 30) push("exam_soon", d <= 3 ? "urgent" : d <= 14 ? "warn" : "info", c.examDate, `${c.name}: exam ${when(d)}.`);
        else if (d < 0) push("exam_past", "warn", c.examDate, `${c.name}: the exam date passed ${ago(d)}. Record the result or set a new date.`);
      }
      if (c.voucherCode && c.voucherExpires) {
        const v = daysUntil(c.voucherExpires, today);
        // A voucher that an upcoming exam will use before it lapses needs no reminder.
        const used = c.examDate !== null && c.examDate >= today && c.examDate <= c.voucherExpires;
        if (v < 0) push("voucher_expired", "urgent", c.voucherExpires, `${c.name}: the voucher expired ${ago(v)}.`);
        else if (v <= 30 && !used) push("voucher_expiring", v <= 7 ? "urgent" : "warn", c.voucherExpires, `${c.name}: voucher expires ${when(v)}${c.examDate && c.examDate > c.voucherExpires ? ", before your exam date" : !c.examDate ? " and no exam is booked" : ""}.`);
      }
    }

    if (c.status === "earned" && c.expiresOn) {
      const d = daysUntil(c.expiresOn, today);
      if (d < 0) push("expired", "urgent", c.expiresOn, `${c.name}: expired ${ago(d)}. Check your issuer's rules to renew or retake.`);
      else if (d <= c.renewalAlertDays) push("renewal_due", d <= 30 ? "urgent" : "warn", c.expiresOn, `${c.name}: renewal due ${when(d)}.`);

      if (c.ceuRequired !== null && c.ceuLogged < c.ceuRequired && d >= 0 && d <= c.renewalAlertDays) {
        const left = c.ceuRequired - c.ceuLogged;
        push("ceu_short", d <= 30 ? "urgent" : "warn", c.expiresOn, `${c.name}: ${units(left)} ${c.ceuUnit} still to log before it expires ${when(d)} (${units(c.ceuLogged)} of ${units(c.ceuRequired)}).`);
      }
    }
  }
  return out.sort((a, b) => rank[a.severity] - rank[b.severity] || (a.daysLeft ?? 9e9) - (b.daysLeft ?? 9e9) || a.credentialName.localeCompare(b.credentialName));
}
