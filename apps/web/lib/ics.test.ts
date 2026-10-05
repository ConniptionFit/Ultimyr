import { describe, expect, it } from "vitest";
import type { Credential } from "./certs";
import { buildIcs, credentialEvents, foldLine, icsText } from "./ics";

const base: Credential = {
  id: "c1", name: "Claude Architect, Foundations", issuer: "Anthropic", archiveId: null, status: "scheduled", credentialNumber: "", examDate: "2026-12-31", examTime: "23:30",
  examMode: "online", examLocation: "", voucherCode: "SECRET-123", voucherExpires: "2026-11-01", earnedOn: null, expiresOn: null, renewalAlertDays: 90, ceuRequired: null, ceuUnit: "CEU", ceuLogged: 0, notes: "", alerts: [],
};

describe("ics", () => {
  it("escapes text", () => expect(icsText("a,b;c\\d\ne")).toBe("a\\,b\;c\\\\d\\ne"));
  it("folds long lines at 75 octets", () => {
    const folded = foldLine("X:" + "é".repeat(100));
    for (const l of folded.split("\r\n")) expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75);
    expect(folded.split("\r\n").map((l, i) => (i ? l.slice(1) : l)).join("")).toBe("X:" + "é".repeat(100));
  });
  it("builds exam and voucher events and never leaks the voucher code", () => {
    const ics = buildIcs([base], new Date("2026-10-05T12:00:00Z"));
    expect(ics).toContain("DTSTART:20261231T233000");
    expect(ics).toContain("DTEND:20270101T013000");
    expect(ics).toContain("DTSTART;VALUE=DATE:20261101");
    expect(ics).not.toContain("SECRET-123");
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });
  it("adds a renewal event for earned credentials with the alert lead time", () => {
    const e = credentialEvents({ ...base, status: "earned", examDate: null, voucherExpires: null, expiresOn: "2028-01-15", renewalAlertDays: 60 });
    expect(e).toHaveLength(1);
    expect(e[0]?.alarmDays).toBe(60);
  });
  it("skips credentials with no dates", () => expect(credentialEvents({ ...base, examDate: null, voucherExpires: null })).toEqual([]));
});
