import { MODE_LABEL, type Credential } from "./certs";

/** Escape text for an iCalendar value (RFC 5545 section 3.3.11). */
export const icsText = (s: string) => s.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/;/g, "\;").replace(/,/g, "\\,");

/** Fold a line at 75 octets, breaking only between characters. */
export function foldLine(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let cur = "";
  let size = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (size + n > (parts.length ? 74 : 75)) {
      parts.push(cur);
      cur = "";
      size = 0;
    }
    cur += ch;
    size += n;
  }
  parts.push(cur);
  return parts.join("\r\n ");
}

const compact = (day: string) => day.replace(/-/g, "");
function nextDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
const stamp = (now: Date) => now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

interface Event {
  uid: string;
  summary: string;
  description: string;
  location?: string;
  day: string;
  time?: string | null;
  alarmDays: number;
}

/** Calendar events for a credential: the exam, voucher expiry and renewal. Voucher codes are never included. */
export function credentialEvents(c: Credential): Event[] {
  const out: Event[] = [];
  if (c.examDate && (c.status === "planned" || c.status === "scheduled")) {
    out.push({
      uid: `${c.id}-exam`,
      summary: `Exam: ${c.name}`,
      description: [c.issuer && `Issuer: ${c.issuer}`, `Format: ${MODE_LABEL[c.examMode]}`].filter(Boolean).join("\n"),
      location: c.examLocation || undefined,
      day: c.examDate,
      time: c.examTime,
      alarmDays: 1,
    });
  }
  if (c.voucherExpires && c.status !== "earned" && c.status !== "retired") {
    out.push({ uid: `${c.id}-voucher`, summary: `Exam voucher expires: ${c.name}`, description: "Book or use your exam voucher before it lapses.", day: c.voucherExpires, alarmDays: 7 });
  }
  if (c.expiresOn && c.status === "earned") {
    out.push({
      uid: `${c.id}-renewal`,
      summary: `Renewal due: ${c.name}`,
      description: c.ceuRequired ? `${c.ceuRequired} ${c.ceuUnit} required, ${c.ceuLogged} logged.` : "Renew before this date.",
      day: c.expiresOn,
      alarmDays: c.renewalAlertDays,
    });
  }
  return out;
}

export function buildIcs(credentials: Credential[], now = new Date()): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Ultimyr//Credentials//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:Ultimyr credentials"];
  for (const c of credentials)
    for (const e of credentialEvents(c)) {
      lines.push("BEGIN:VEVENT", `UID:${e.uid}@ultimyr`, `DTSTAMP:${stamp(now)}`);
      if (e.time) {
        const [h = 0, m = 0] = e.time.split(":").map(Number);
        const end = `${String((h + 2) % 24).padStart(2, "0")}${String(m).padStart(2, "0")}00`;
        const endDay = h + 2 >= 24 ? nextDay(e.day) : e.day;
        lines.push(`DTSTART:${compact(e.day)}T${e.time.replace(":", "")}00`, `DTEND:${compact(endDay)}T${end}`);
      } else {
        lines.push(`DTSTART;VALUE=DATE:${compact(e.day)}`, `DTEND;VALUE=DATE:${compact(nextDay(e.day))}`);
      }
      lines.push(`SUMMARY:${icsText(e.summary)}`);
      if (e.description) lines.push(`DESCRIPTION:${icsText(e.description)}`);
      if (e.location) lines.push(`LOCATION:${icsText(e.location)}`);
      lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsText(e.summary)}`, `TRIGGER:-P${e.alarmDays}D`, "END:VALARM", "END:VEVENT");
    }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
