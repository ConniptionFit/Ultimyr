import { HttpError, idParam, parse, uuidv7 } from "@ultimyr/service-kit";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { loadArchive } from "../access.js";
import { computeAlerts, type Alert, type AlertInput } from "../credential-alerts.js";
import type { Ctx } from "../ctx.js";

const MAX_CREDENTIALS = 200;
const MAX_ENTRIES = 2000;
const date = z.iso.date();
const text = (max: number) => z.string().trim().max(max);

const credentialFields = {
  name: text(160).min(1),
  issuer: text(120).default(""),
  archiveId: z.uuid().nullable().optional(),
  status: z.enum(["planned", "scheduled", "earned", "retired"]).default("planned"),
  credentialNumber: text(120).default(""),
  examDate: date.nullable().optional(),
  examTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "use 24 hour HH:MM").nullable().optional(),
  examMode: z.enum(["unknown", "test_center", "online"]).default("unknown"),
  examLocation: text(200).default(""),
  voucherCode: text(200).default(""),
  voucherExpires: date.nullable().optional(),
  earnedOn: date.nullable().optional(),
  expiresOn: date.nullable().optional(),
  renewalAlertDays: z.number().int().min(1).max(730).default(90),
  ceuRequired: z.number().positive().max(99_999).nullable().optional(),
  ceuUnit: z.enum(["CEU", "PDU", "CPE", "hours"]).default("CEU"),
  notes: text(4000).default(""),
};
const createBody = z.object(credentialFields);
const patchBody = z.object(credentialFields).partial();
const entryBody = z.object({
  title: text(200).min(1),
  units: z.number().positive().max(9999),
  earnedOn: date,
  category: text(80).default(""),
  notes: text(1000).default(""),
});
const entryPatch = entryBody.partial();

/** Columns with dates as plain YYYY-MM-DD text, so time zones never shift a day. */
const D = (c: string) => `to_char(${c}, 'YYYY-MM-DD')`;
const COLS = `id, user_id, name, issuer, archive_id, status, credential_number, ${D("exam_date")} AS exam_date, exam_time, exam_mode, exam_location,
  voucher_code, ${D("voucher_expires")} AS voucher_expires, ${D("earned_on")} AS earned_on, ${D("expires_on")} AS expires_on,
  renewal_alert_days, ceu_required::float8 AS ceu_required, ceu_unit, notes, created_at, updated_at`;
const ENTRY_COLS = `id, credential_id, title, units::float8 AS units, ${D("earned_on")} AS earned_on, category, notes, created_at`;

type Row = Record<string, any>;

function checkDates(c: { status: string; examDate?: string | null; earnedOn?: string | null; expiresOn?: string | null; ceuRequired?: number | null }) {
  const issues: string[] = [];
  if (c.earnedOn && c.expiresOn && c.expiresOn < c.earnedOn) issues.push("expiresOn: must not be before earnedOn");
  if (issues.length) throw new HttpError(400, "invalid_request", { issues });
}

export function credentialRoutes(ctx: Ctx) {
  const { pool } = ctx;
  const today = () => ctx.now().toISOString().slice(0, 10);

  const out = (r: Row, ceuLogged: number, alerts: Alert[]) => ({
    id: r.id,
    name: r.name,
    issuer: r.issuer,
    archiveId: r.archive_id,
    status: r.status,
    credentialNumber: r.credential_number,
    examDate: r.exam_date,
    examTime: r.exam_time,
    examMode: r.exam_mode,
    examLocation: r.exam_location,
    voucherCode: r.voucher_code,
    voucherExpires: r.voucher_expires,
    earnedOn: r.earned_on,
    expiresOn: r.expires_on,
    renewalAlertDays: r.renewal_alert_days,
    ceuRequired: r.ceu_required,
    ceuUnit: r.ceu_unit,
    ceuLogged,
    notes: r.notes,
    alerts: alerts.filter((a) => a.credentialId === r.id),
    updatedAt: r.updated_at,
  });
  const entryOut = (e: Row) => ({ id: e.id, title: e.title, units: e.units, earnedOn: e.earned_on, category: e.category, notes: e.notes });

  /** Units logged inside the renewal cycle: from the day it was earned to the day it expires, when those are known. */
  async function ceuTotals(userId: string): Promise<Map<string, number>> {
    const { rows } = await pool.query(
      `SELECT c.id, COALESCE(sum(e.units) FILTER (WHERE (c.earned_on IS NULL OR e.earned_on >= c.earned_on) AND (c.expires_on IS NULL OR e.earned_on <= c.expires_on)), 0)::float8 AS logged
         FROM content.credentials c LEFT JOIN content.ceu_entries e ON e.credential_id = c.id WHERE c.user_id = $1 GROUP BY c.id`,
      [userId],
    );
    return new Map(rows.map((r) => [r.id as string, Number(r.logged)]));
  }

  async function all(userId: string) {
    const { rows } = await pool.query(`SELECT ${COLS} FROM content.credentials WHERE user_id = $1 ORDER BY CASE status WHEN 'scheduled' THEN 0 WHEN 'planned' THEN 1 WHEN 'earned' THEN 2 ELSE 3 END, exam_date NULLS LAST, expires_on NULLS LAST, name`, [userId]);
    const totals = await ceuTotals(userId);
    const alerts = computeAlerts(
      rows.map(
        (r): AlertInput => ({
          id: r.id,
          name: r.name,
          status: r.status,
          examDate: r.exam_date,
          voucherCode: r.voucher_code,
          voucherExpires: r.voucher_expires,
          earnedOn: r.earned_on,
          expiresOn: r.expires_on,
          renewalAlertDays: r.renewal_alert_days,
          ceuRequired: r.ceu_required,
          ceuUnit: r.ceu_unit,
          ceuLogged: totals.get(r.id) ?? 0,
        }),
      ),
      today(),
    );
    return { rows, totals, alerts };
  }

  /** A credential that belongs to the caller. Someone else's id reads as not found. */
  async function mine(userId: string, id: string): Promise<Row> {
    const { rows } = await pool.query(`SELECT ${COLS} FROM content.credentials WHERE id = $1 AND user_id = $2`, [id, userId]);
    if (!rows[0]) throw new HttpError(404, "not_found");
    return rows[0];
  }

  /** A linked archive must be one the caller can see; anything else is refused without saying whether it exists. */
  async function checkArchive(a: Awaited<ReturnType<Ctx["actor"]>>, archiveId: string | null | undefined) {
    if (!archiveId) return;
    try {
      await loadArchive(pool, a, archiveId);
    } catch {
      throw new HttpError(400, "invalid_request", { issues: ["archiveId: not an archive you can see"] });
    }
  }

  const COLUMN: Record<string, string> = {
    name: "name", issuer: "issuer", archiveId: "archive_id", status: "status", credentialNumber: "credential_number", examDate: "exam_date", examTime: "exam_time",
    examMode: "exam_mode", examLocation: "exam_location", voucherCode: "voucher_code", voucherExpires: "voucher_expires", earnedOn: "earned_on", expiresOn: "expires_on",
    renewalAlertDays: "renewal_alert_days", ceuRequired: "ceu_required", ceuUnit: "ceu_unit", notes: "notes",
  };

  return async (r: FastifyInstance) => {
    r.get("/v1/credentials", async (req) => {
      const a = await ctx.actor(req, "content:read");
      const { rows, totals, alerts } = await all(a.userId);
      return { credentials: rows.map((c) => out(c, totals.get(c.id) ?? 0, alerts)), alerts };
    });

    /** Everything that needs attention, most urgent first. Safe to poll from a banner. */
    r.get("/v1/credentials/alerts", async (req) => {
      const a = await ctx.actor(req, "content:read");
      return { today: today(), alerts: (await all(a.userId)).alerts };
    });

    r.post("/v1/credentials", async (req, reply) => {
      const a = await ctx.actor(req, "content:write");
      const body = parse(createBody, req.body);
      checkDates(body);
      await checkArchive(a, body.archiveId);
      const { rows: n } = await pool.query("SELECT count(*)::int AS n FROM content.credentials WHERE user_id = $1", [a.userId]);
      if (n[0].n >= MAX_CREDENTIALS) throw new HttpError(409, "limit_reached", { issues: [`at most ${MAX_CREDENTIALS} credentials`] });
      const id = uuidv7();
      await pool.query(
        `INSERT INTO content.credentials (id, user_id, name, issuer, archive_id, status, credential_number, exam_date, exam_time, exam_mode, exam_location,
           voucher_code, voucher_expires, earned_on, expires_on, renewal_alert_days, ceu_required, ceu_unit, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
        [id, a.userId, body.name, body.issuer, body.archiveId ?? null, body.status, body.credentialNumber, body.examDate ?? null, body.examTime ?? null, body.examMode,
          body.examLocation, body.voucherCode, body.voucherExpires ?? null, body.earnedOn ?? null, body.expiresOn ?? null, body.renewalAlertDays, body.ceuRequired ?? null, body.ceuUnit, body.notes],
      );
      const { rows, totals, alerts } = await all(a.userId);
      return reply.code(201).send(out(rows.find((c) => c.id === id)!, totals.get(id) ?? 0, alerts));
    });

    r.get("/v1/credentials/:id", async (req) => {
      const a = await ctx.actor(req, "content:read");
      const row = await mine(a.userId, idParam(req));
      const { totals, alerts } = await all(a.userId);
      const { rows: entries } = await pool.query(`SELECT ${ENTRY_COLS} FROM content.ceu_entries WHERE credential_id = $1 ORDER BY earned_on DESC, created_at DESC`, [row.id]);
      return { ...out(row, totals.get(row.id) ?? 0, alerts), entries: entries.map(entryOut) };
    });

    r.patch("/v1/credentials/:id", async (req) => {
      const a = await ctx.actor(req, "content:write");
      const row = await mine(a.userId, idParam(req));
      const body = parse(patchBody, req.body);
      // The schema's defaults must not overwrite fields the caller left out of a partial update.
      const given = Object.keys((req.body ?? {}) as object).filter((k) => k in COLUMN && (body as Row)[k] !== undefined);
      if (!given.length) throw new HttpError(400, "invalid_request", { issues: ["nothing to change"] });
      checkDates({ status: body.status ?? row.status, earnedOn: body.earnedOn !== undefined ? body.earnedOn : row.earned_on, expiresOn: body.expiresOn !== undefined ? body.expiresOn : row.expires_on });
      if (given.includes("archiveId")) await checkArchive(a, body.archiveId);
      const sets: string[] = [];
      const vals: unknown[] = [row.id, a.userId];
      for (const k of given) sets.push(`${COLUMN[k]} = $${vals.push((body as Row)[k] ?? null)}`);
      await pool.query(`UPDATE content.credentials SET ${sets.join(", ")}, updated_at = now() WHERE id = $1 AND user_id = $2`, vals);
      const { rows, totals, alerts } = await all(a.userId);
      return out(rows.find((c) => c.id === row.id)!, totals.get(row.id) ?? 0, alerts);
    });

    r.delete("/v1/credentials/:id", async (req, reply) => {
      const a = await ctx.actor(req, "content:write");
      await pool.query("DELETE FROM content.credentials WHERE id = $1 AND user_id = $2", [idParam(req), a.userId]);
      return reply.code(204).send();
    });

    r.post("/v1/credentials/:id/ceu", async (req, reply) => {
      const a = await ctx.actor(req, "content:write");
      const row = await mine(a.userId, idParam(req));
      const body = parse(entryBody, req.body);
      const { rows: n } = await pool.query("SELECT count(*)::int AS n FROM content.ceu_entries WHERE credential_id = $1", [row.id]);
      if (n[0].n >= MAX_ENTRIES) throw new HttpError(409, "limit_reached", { issues: [`at most ${MAX_ENTRIES} entries`] });
      const { rows } = await pool.query(
        `INSERT INTO content.ceu_entries (id, credential_id, user_id, title, units, earned_on, category, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${ENTRY_COLS}`,
        [uuidv7(), row.id, a.userId, body.title, body.units, body.earnedOn, body.category, body.notes],
      );
      return reply.code(201).send(entryOut(rows[0]));
    });

    r.patch("/v1/credentials/:id/ceu/:entryId", async (req) => {
      const a = await ctx.actor(req, "content:write");
      const row = await mine(a.userId, idParam(req));
      const body = parse(entryPatch, req.body);
      const map: Record<string, string> = { title: "title", units: "units", earnedOn: "earned_on", category: "category", notes: "notes" };
      const keys = Object.keys(body).filter((k) => (body as Row)[k] !== undefined);
      if (!keys.length) throw new HttpError(400, "invalid_request", { issues: ["nothing to change"] });
      const vals: unknown[] = [idParam(req, "entryId"), row.id];
      const sets = keys.map((k) => `${map[k]} = $${vals.push((body as Row)[k])}`);
      const { rows } = await pool.query(`UPDATE content.ceu_entries SET ${sets.join(", ")} WHERE id = $1 AND credential_id = $2 RETURNING ${ENTRY_COLS}`, vals);
      if (!rows[0]) throw new HttpError(404, "not_found");
      return entryOut(rows[0]);
    });

    r.delete("/v1/credentials/:id/ceu/:entryId", async (req, reply) => {
      const a = await ctx.actor(req, "content:write");
      const row = await mine(a.userId, idParam(req));
      await pool.query("DELETE FROM content.ceu_entries WHERE id = $1 AND credential_id = $2", [idParam(req, "entryId"), row.id]);
      return reply.code(204).send();
    });
  };
}
