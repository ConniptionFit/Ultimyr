import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { computeAlerts, daysUntil, type AlertInput } from "../src/credential-alerts.js";
import { createHarness, testDbUrl, uuid, type Harness } from "./helpers.js";

const base: AlertInput = {
  id: "c1",
  name: "Sec+",
  status: "planned",
  examDate: null,
  voucherCode: "",
  voucherExpires: null,
  earnedOn: null,
  expiresOn: null,
  renewalAlertDays: 90,
  ceuRequired: null,
  ceuUnit: "CEU",
  ceuLogged: 0,
};
const TODAY = "2026-10-04";
const kinds = (c: Partial<AlertInput>) => computeAlerts([{ ...base, ...c }], TODAY).map((a) => `${a.kind}:${a.severity}`);

describe("credential alerts", () => {
  it("counts days between plain dates, across month ends and leap days", () => {
    expect(daysUntil("2026-10-05", TODAY)).toBe(1);
    expect(daysUntil("2026-10-04", TODAY)).toBe(0);
    expect(daysUntil("2026-09-30", TODAY)).toBe(-4);
    expect(daysUntil("2028-03-01", "2028-02-28")).toBe(2);
  });

  it("warns about an exam on a ladder of urgency, and stays quiet when it is far off", () => {
    expect(kinds({ status: "scheduled", examDate: "2026-10-04" })).toEqual(["exam_today:urgent"]);
    expect(kinds({ status: "scheduled", examDate: "2026-10-06" })).toEqual(["exam_soon:urgent"]);
    expect(kinds({ status: "scheduled", examDate: "2026-10-15" })).toEqual(["exam_soon:warn"]);
    expect(kinds({ status: "scheduled", examDate: "2026-11-01" })).toEqual(["exam_soon:info"]);
    expect(kinds({ status: "scheduled", examDate: "2026-12-01" })).toEqual([]);
    expect(kinds({ status: "scheduled", examDate: "2026-10-01" })).toEqual(["exam_past:warn"]);
  });

  it("reminds about vouchers only when no exam will use them in time", () => {
    expect(kinds({ voucherCode: "ABC", voucherExpires: "2026-10-20" })).toEqual(["voucher_expiring:warn"]);
    expect(kinds({ voucherCode: "ABC", voucherExpires: "2026-10-08" })).toEqual(["voucher_expiring:urgent"]);
    expect(kinds({ voucherCode: "ABC", voucherExpires: "2026-10-20", status: "scheduled", examDate: "2026-10-18" })).toEqual(["exam_soon:warn"]);
    expect(kinds({ voucherCode: "ABC", voucherExpires: "2026-10-20", status: "scheduled", examDate: "2026-10-25" })).toEqual(["voucher_expiring:warn", "exam_soon:info"]);
    expect(kinds({ voucherCode: "ABC", voucherExpires: "2026-10-01" })).toEqual(["voucher_expired:urgent"]);
    expect(kinds({ voucherCode: "", voucherExpires: "2026-10-05" })).toEqual([]);
    expect(kinds({ status: "earned", voucherCode: "ABC", voucherExpires: "2026-10-05" })).toEqual([]);
  });

  it("raises renewal and continuing education alerts inside the alert window", () => {
    const earned = { status: "earned" as const, earnedOn: "2024-01-01", expiresOn: "2027-01-01" };
    expect(kinds({ ...earned, expiresOn: "2027-03-01" })).toEqual([]);
    expect(kinds(earned)).toEqual(["renewal_due:warn"]);
    expect(kinds({ ...earned, expiresOn: "2026-12-01" })).toEqual(["renewal_due:warn"]);
    expect(kinds({ ...earned, expiresOn: "2026-10-20" })).toEqual(["renewal_due:urgent"]);
    expect(kinds({ ...earned, expiresOn: "2026-10-01" })).toEqual(["expired:urgent"]);
    expect(kinds({ ...earned, expiresOn: "2026-12-01", ceuRequired: 50, ceuLogged: 20 })).toEqual(["renewal_due:warn", "ceu_short:warn"]);
    expect(kinds({ ...earned, expiresOn: "2026-12-01", ceuRequired: 50, ceuLogged: 50 })).toEqual(["renewal_due:warn"]);
    const msg = computeAlerts([{ ...base, ...earned, expiresOn: "2026-12-01", ceuRequired: 50, ceuLogged: 20.5, ceuUnit: "PDU" }], TODAY).find((a) => a.kind === "ceu_short")!;
    expect(msg.message).toContain("29.5 PDU still to log");
    expect(kinds({ ...earned, status: "retired" as never, expiresOn: "2026-10-01" })).toEqual([]);
  });

  it("sorts the most urgent and soonest first", () => {
    const list = computeAlerts(
      [
        { ...base, id: "a", name: "A", status: "scheduled", examDate: "2026-10-30" },
        { ...base, id: "b", name: "B", status: "earned", earnedOn: "2024-01-01", expiresOn: "2026-10-10" },
        { ...base, id: "c", name: "C", status: "scheduled", examDate: "2026-10-12" },
      ],
      TODAY,
    );
    expect(list.map((a) => a.credentialName)).toEqual(["B", "C", "A"]);
  });
});

describe.skipIf(!testDbUrl)("credential tracker api", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
    h.clock.now = new Date("2026-10-04T12:00:00Z");
  });
  afterAll(() => h.close());

  const alice = uuid();
  const bob = uuid();
  const call = async (u: string, method: string, url: string, payload?: unknown, extra: { scopes?: string[] } = {}) =>
    h.app.inject({ method: method as any, url, headers: await h.issuer.bearer({ userId: u, ...extra }), ...(payload !== undefined ? { payload: payload as any } : {}) });
  const json = (r: { body: string }) => JSON.parse(r.body);

  it("creates, reads and updates a credential with dates kept as plain days", async () => {
    const created = await call(alice, "POST", "/v1/credentials", { name: "CompTIA A+", issuer: "CompTIA", status: "scheduled", examDate: "2026-10-12", examTime: "09:30", examMode: "online", voucherCode: "V-123", voucherExpires: "2027-01-01" });
    expect(created.statusCode).toBe(201);
    const c = json(created);
    expect(c).toMatchObject({ name: "CompTIA A+", examDate: "2026-10-12", examTime: "09:30", examMode: "online", voucherCode: "V-123", renewalAlertDays: 90, ceuUnit: "CEU", ceuLogged: 0 });
    expect(c.alerts.map((a: any) => a.kind)).toEqual(["exam_soon"]);

    const patched = await call(alice, "PATCH", `/v1/credentials/${c.id}`, { examDate: "2026-10-30", notes: "bring ID" });
    expect(patched.statusCode).toBe(200);
    // A partial update leaves every other field alone, including ones the schema gives defaults to.
    expect(json(patched)).toMatchObject({ examDate: "2026-10-30", notes: "bring ID", issuer: "CompTIA", examMode: "online", voucherCode: "V-123", renewalAlertDays: 90 });
    const cleared = json(await call(alice, "PATCH", `/v1/credentials/${c.id}`, { examDate: null }));
    expect(cleared.examDate).toBeNull();
    expect((await call(alice, "PATCH", `/v1/credentials/${c.id}`, {})).statusCode).toBe(400);
  });

  it("validates input", async () => {
    for (const bad of [{}, { name: "" }, { name: "x", examDate: "10/12/2026" }, { name: "x", examTime: "9am" }, { name: "x", status: "done" }, { name: "x", renewalAlertDays: 0 }, { name: "x", earnedOn: "2026-05-01", expiresOn: "2026-04-01" }])
      expect((await call(alice, "POST", "/v1/credentials", bad)).statusCode, JSON.stringify(bad)).toBe(400);
  });

  it("keeps credentials private to their owner", async () => {
    const id = json(await call(alice, "POST", "/v1/credentials", { name: "Private" })).id;
    expect((await call(bob, "GET", `/v1/credentials/${id}`)).statusCode).toBe(404);
    expect((await call(bob, "PATCH", `/v1/credentials/${id}`, { name: "Mine now" })).statusCode).toBe(404);
    expect((await call(bob, "POST", `/v1/credentials/${id}/ceu`, { title: "x", units: 1, earnedOn: "2026-01-01" })).statusCode).toBe(404);
    await call(bob, "DELETE", `/v1/credentials/${id}`);
    expect((await call(alice, "GET", `/v1/credentials/${id}`)).statusCode).toBe(200);
    expect(json(await call(bob, "GET", "/v1/credentials")).credentials).toEqual([]);
  });

  it("needs the right token scopes", async () => {
    expect((await call(alice, "GET", "/v1/credentials", undefined, { scopes: ["quiz:read"] })).statusCode).toBe(403);
    expect((await call(alice, "POST", "/v1/credentials", { name: "x" }, { scopes: ["content:read"] })).statusCode).toBe(403);
    expect((await call(alice, "GET", "/v1/credentials", undefined, { scopes: ["content:read"] })).statusCode).toBe(200);
  });

  it("only links archives the person can see", async () => {
    const mine = json(await call(alice, "POST", "/v1/archives", { title: `Mine ${uuid().slice(0, 4)}`, visibility: "private" })).id;
    const ok = await call(alice, "POST", "/v1/credentials", { name: "Linked", archiveId: mine });
    expect(ok.statusCode).toBe(201);
    expect(json(ok).archiveId).toBe(mine);
    const nope = await call(bob, "POST", "/v1/credentials", { name: "Sneaky", archiveId: mine });
    expect(nope.statusCode).toBe(400);
    // Deleting the archive unlinks the credential rather than deleting it.
    await h.pool.query("DELETE FROM content.master_items WHERE id = $1", [mine]);
    expect(json(await call(alice, "GET", `/v1/credentials/${json(ok).id}`)).archiveId).toBeNull();
  });

  it("logs continuing education hours inside the renewal cycle and raises a shortfall alert", async () => {
    const c = json(await call(alice, "POST", "/v1/credentials", { name: "PMP", status: "earned", earnedOn: "2024-12-01", expiresOn: "2026-12-01", ceuRequired: 60, ceuUnit: "PDU" }));
    const add = (title: string, units: number, earnedOn: string) => call(alice, "POST", `/v1/credentials/${c.id}/ceu`, { title, units, earnedOn, category: "Course" });
    const a = json(await add("Course A", 12.5, "2025-03-01"));
    await add("Course B", 10, "2026-02-01");
    await add("Before the cycle", 99, "2024-01-01"); // outside the cycle: kept, not counted
    await add("After the cycle", 99, "2027-01-01");
    expect((await add("Zero", 0, "2026-01-01")).statusCode).toBe(400);
    const detail = json(await call(alice, "GET", `/v1/credentials/${c.id}`));
    expect(detail.ceuLogged).toBe(22.5);
    expect(detail.entries).toHaveLength(4);
    expect(detail.alerts.map((x: any) => x.kind).sort()).toEqual(["ceu_short", "renewal_due"]);

    expect(json(await call(alice, "PATCH", `/v1/credentials/${c.id}/ceu/${a.id}`, { units: 50 })).units).toBe(50);
    expect(json(await call(alice, "GET", `/v1/credentials/${c.id}`)).ceuLogged).toBe(60);
    expect(json(await call(alice, "GET", `/v1/credentials/${c.id}`)).alerts.map((x: any) => x.kind)).toEqual(["renewal_due"]);
    expect((await call(alice, "DELETE", `/v1/credentials/${c.id}/ceu/${a.id}`)).statusCode).toBe(204);
    expect(json(await call(alice, "GET", `/v1/credentials/${c.id}`)).ceuLogged).toBe(10);
    expect((await call(alice, "PATCH", `/v1/credentials/${c.id}/ceu/${uuid()}`, { units: 1 })).statusCode).toBe(404);
  });

  it("lists every alert, most urgent first", async () => {
    const res = json(await call(alice, "GET", "/v1/credentials/alerts"));
    expect(res.today).toBe("2026-10-04");
    const order = { urgent: 0, warn: 1, info: 2 } as const;
    const sevs = res.alerts.map((a: any) => order[a.severity as keyof typeof order]);
    expect(sevs).toEqual([...sevs].sort((x: number, y: number) => x - y));
    expect(res.alerts.length).toBeGreaterThan(0);
  });

  it("deleting a credential removes its entries", async () => {
    const c = json(await call(alice, "POST", "/v1/credentials", { name: "Temp" }));
    await call(alice, "POST", `/v1/credentials/${c.id}/ceu`, { title: "x", units: 1, earnedOn: "2026-01-01" });
    expect((await call(alice, "DELETE", `/v1/credentials/${c.id}`)).statusCode).toBe(204);
    const { rows } = await h.pool.query("SELECT count(*)::int AS n FROM content.ceu_entries WHERE credential_id = $1", [c.id]);
    expect(rows[0].n).toBe(0);
  });
});
