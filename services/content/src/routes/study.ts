import { DEFAULT_W, State, newCard, nextInterval, preview, retrievability, review, type CardState, type Params, type Rating } from "@ultimyr/fsrs";
import { HttpError, parse, resolveZone, uuidv7 } from "@ultimyr/service-kit";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ARCHIVE_REL, ITEM_GRANT, RANK, loadItem } from "../access.js";
import type { Ctx } from "../ctx.js";
import { csvField } from "../markdown.js";

const queueQuery = z.object({
  archive: z.uuid().optional(),
  deck: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  /** IANA time zone, so the daily new-card allowance resets at the person's own midnight. */
  tz: z.string().max(64).optional(),
  /** Also include cards that fall due within this many days ("study ahead"). New cards are left out when set. */
  ahead: z.coerce.number().int().min(0).max(30).default(0),
});
const reviewBody = z.object({
  cardId: z.uuid(),
  rating: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  durationMs: z.number().int().min(0).max(3_600_000).default(0),
});
const undoBody = z.object({ reviewId: z.uuid() });
const settingsBody = z.object({
  desiredRetention: z.number().min(0.7).max(0.99).optional(),
  newPerDay: z.number().int().min(0).max(500).optional(),
  leechSuspend: z.boolean().optional(),
});
/** A card forgotten this many times is a leech. */
const LEECH_LAPSES = 8;
const suspendBody = z.object({ suspended: z.boolean() });
const buryBody = z.object({ tz: z.string().max(64).optional() });

type Row = Record<string, any>;

/** Reviews per day to keep these cards at `retention`: each is seen about once per interval. */
export const workload = (stabilities: number[], retention: number) => stabilities.reduce((sum, st) => sum + 1 / nextInterval(st, retention), 0);
const toState = (r: Row): CardState => ({
  state: r.state as State,
  stability: r.stability,
  difficulty: r.difficulty,
  reps: r.reps,
  lapses: r.lapses,
  lastReview: r.last_review ? new Date(r.last_review).getTime() : null,
  due: new Date(r.due).getTime(),
});

export function studyRoutes(ctx: Ctx) {
  const { pool } = ctx;

  async function settings(userId: string) {
    const { rows } = await pool.query("SELECT * FROM content.study_settings WHERE user_id = $1", [userId]);
    return { desiredRetention: rows[0]?.desired_retention ?? 0.9, newPerDay: rows[0]?.new_per_day ?? 20, leechSuspend: rows[0]?.leech_suspend ?? false };
  }
  const params = (s: { desiredRetention: number }): Params => ({ w: DEFAULT_W, desiredRetention: s.desiredRetention });

  const cardOut = (c: Row, st: CardState, now: number, p: Params) => ({
    id: c.id,
    front: c.front,
    back: c.back,
    hint: c.hint,
    tags: c.tags,
    deckId: c.deck_id,
    deckTitle: c.deck_title,
    archiveId: c.archive_id,
    state: st.state,
    lapses: st.lapses,
    due: new Date(st.due).toISOString(),
    // What each button would schedule, so the UI can label them ("again 1 min", "good 3 days").
    next: Object.fromEntries(Object.entries(preview(st, now, p)).map(([g, v]) => [g, { due: new Date(v.due).toISOString(), days: v.scheduledDays }])),
  });

  /** Not suspended or buried for the person in $1 at the time in $5. */
  const AWAKE = (card: string, user = "$1", now = "$5") => `NOT EXISTS (SELECT 1 FROM content.card_flags f WHERE f.user_id = ${user} AND f.card_id = ${card} AND (f.suspended OR f.buried_until > ${now}))`;

  /** Cards the caller may study: published decks they can read, optionally narrowed to one archive or deck. $1 user, $2 groups, $3 archive, $4 deck. */
  const READABLE = `
    SELECT c.*, s.master_item_id AS archive_id, s.title AS deck_title
      FROM content.cards c
      JOIN (
        SELECT s.*, GREATEST((SELECT m2.rel FROM acc m2 WHERE m2.id = s.master_item_id), ${ITEM_GRANT}) AS irel
          FROM content.sub_items s
         WHERE s.kind = 'deck' AND s.deleted_at IS NULL AND s.master_item_id IN (SELECT id FROM acc) AND ($4::uuid IS NULL OR s.id = $4)
      ) s ON s.id = c.deck_id
     WHERE s.irel >= ${RANK.viewer} AND (s.status = 'published' OR s.irel >= ${RANK.editor})`;
  const ACC = `acc AS (SELECT m.id, ${ARCHIVE_REL} AS rel FROM content.master_items m WHERE m.deleted_at IS NULL AND ($3::uuid IS NULL OR m.id = $3))`;

  async function setFlag(userId: string, cardId: string, archiveId: string, f: { suspended?: boolean; buriedUntil?: Date | null }) {
    await pool.query(
      `INSERT INTO content.card_flags (user_id, card_id, archive_id, suspended, buried_until) VALUES ($1,$2,$3,COALESCE($4,false),$5)
       ON CONFLICT (user_id, card_id) DO UPDATE SET suspended = COALESCE($4, content.card_flags.suspended), buried_until = CASE WHEN $6 THEN $5 ELSE content.card_flags.buried_until END`,
      [userId, cardId, archiveId, f.suspended ?? null, f.buriedUntil ?? null, f.buriedUntil !== undefined],
    );
  }
  /** A card the caller may study, with its course id; 404 when it cannot be read (same rule as reviewing it). */
  async function readableCard(a: Parameters<typeof loadItem>[1], id: string) {
    const { rows } = await pool.query("SELECT c.id, c.front, c.deck_id, s.master_item_id AS archive_id, s.title AS deck_title FROM content.cards c JOIN content.sub_items s ON s.id = c.deck_id WHERE c.id = $1", [id]);
    const card = rows[0];
    if (!card) throw new HttpError(404, "not_found");
    const { rel } = await loadItem(pool, a, card.deck_id);
    if (rel < RANK.viewer) throw new HttpError(404, "not_found");
    return card;
  }

  return async (r: FastifyInstance) => {
    r.get("/v1/study/settings", async (req) => settings((await ctx.actor(req, "content:read")).userId));

    r.put("/v1/study/settings", async (req) => {
      const a = await ctx.actor(req, "content:write");
      const body = parse(settingsBody, req.body);
      const cur = await settings(a.userId);
      const next = { desiredRetention: body.desiredRetention ?? cur.desiredRetention, newPerDay: body.newPerDay ?? cur.newPerDay, leechSuspend: body.leechSuspend ?? cur.leechSuspend };
      await pool.query(
        `INSERT INTO content.study_settings (user_id, desired_retention, new_per_day, leech_suspend) VALUES ($1,$2,$3,$4)
         ON CONFLICT (user_id) DO UPDATE SET desired_retention = $2, new_per_day = $3, leech_suspend = $4, updated_at = now()`,
        [a.userId, next.desiredRetention, next.newPerDay, next.leechSuspend],
      );
      return next;
    });

    /** Today's work: cards that are due (oldest first), then new cards up to the daily allowance. */
    r.get("/v1/study/queue", async (req) => {
      const a = await ctx.actor(req, "content:read");
      const q = parse(queueQuery, req.query);
      const s = await settings(a.userId);
      const p = params(s);
      const now = ctx.now();
      const nowDate = now;
      const base = [a.userId, a.groups, q.archive ?? null, q.deck ?? null, nowDate];
      const { rows: due } = await pool.query(
        `WITH ${ACC}, readable AS (${READABLE})
         SELECT r.*, st.state, st.stability, st.difficulty, st.reps, st.lapses, st.last_review, st.due
           FROM readable r JOIN content.srs_state st ON st.card_id = r.id AND st.user_id = $1
          WHERE st.due <= $7 AND ${AWAKE("r.id")} ORDER BY st.due LIMIT $6`,
        [...base, q.limit, new Date(now.getTime() + q.ahead * 86_400_000)],
      );
      const zone = await resolveZone(pool, q.tz);
      const { rows: today } = await pool.query("SELECT count(*)::int AS n FROM content.srs_reviews WHERE user_id = $1 AND state_before = 0 AND reviewed_at >= date_trunc('day', $2::timestamptz AT TIME ZONE $3) AT TIME ZONE $3", [a.userId, now, zone]);
      const room = q.ahead ? 0 : Math.max(0, Math.min(s.newPerDay - today[0].n, q.limit - due.length));
      const { rows: fresh } = room
        ? await pool.query(
            `WITH ${ACC}, readable AS (${READABLE})
             SELECT r.* FROM readable r WHERE NOT EXISTS (SELECT 1 FROM content.srs_state st WHERE st.card_id = r.id AND st.user_id = $1) AND ${AWAKE("r.id")}
              ORDER BY r.deck_id, r.ord, r.created_at LIMIT $6`,
            [...base, room],
          )
        : { rows: [] as Row[] };
      const nowMs = now.getTime();
      return {
        settings: s,
        counts: { due: due.length, new: fresh.length, aheadDays: q.ahead, newAllowanceLeft: Math.max(0, s.newPerDay - today[0].n) },
        cards: [...due.map((c) => cardOut(c, toState(c), nowMs, p)), ...fresh.map((c) => cardOut(c, newCard(nowMs), nowMs, p))],
      };
    });

    r.post("/v1/study/review", async (req) => {
      const a = await ctx.actor(req, "content:write");
      const body = parse(reviewBody, req.body);
      const { rows: cards } = await pool.query("SELECT c.*, s.master_item_id AS archive_id FROM content.cards c JOIN content.sub_items s ON s.id = c.deck_id WHERE c.id = $1", [body.cardId]);
      const card = cards[0];
      if (!card) throw new HttpError(404, "not_found");
      const { rel } = await loadItem(pool, a, card.deck_id); // same rules as reading the deck: 404 when not readable
      if (rel < RANK.viewer) throw new HttpError(404, "not_found");
      const s = await settings(a.userId);
      const p = params(s);
      const now = ctx.now();
      const nowMs = now.getTime();
      const { rows: cur } = await pool.query("SELECT * FROM content.srs_state WHERE user_id = $1 AND card_id = $2", [a.userId, card.id]);
      const before = cur[0] ? toState(cur[0]) : newCard(nowMs);
      const out = review(before, body.rating as Rating, nowMs, p);
      const n = out.card;
      await pool.query(
        `INSERT INTO content.srs_state (user_id, card_id, deck_id, archive_id, state, stability, difficulty, reps, lapses, last_review, due)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (user_id, card_id) DO UPDATE SET state = $5, stability = $6, difficulty = $7, reps = $8, lapses = $9, last_review = $10, due = $11`,
        [a.userId, card.id, card.deck_id, card.archive_id, n.state, n.stability, n.difficulty, n.reps, n.lapses, new Date(nowMs), new Date(n.due)],
      );
      const reviewId = uuidv7();
      await pool.query(
        "INSERT INTO content.srs_reviews (id, user_id, card_id, archive_id, rating, state_before, elapsed_days, scheduled_days, duration_ms, reviewed_at, prev_state) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
        [reviewId, a.userId, card.id, card.archive_id, body.rating, before.state, before.lastReview === null ? null : (nowMs - before.lastReview) / 86_400_000, out.scheduledDays, body.durationMs, now, cur[0] ? JSON.stringify(before) : null],
      );
      // A leech is suspended for you when you have asked for that; the review itself is still recorded.
      const leech = body.rating === 1 && n.lapses >= LEECH_LAPSES;
      const suspended = leech && s.leechSuspend;
      if (suspended) await setFlag(a.userId, card.id, card.archive_id, { suspended: true });
      return { reviewId, state: n.state, due: new Date(n.due).toISOString(), scheduledDays: out.scheduledDays, reps: n.reps, lapses: n.lapses, leech, suspended };
    });

    /** Suspend a card so it stops appearing for you, or bring it back. Other people are not affected. */
    r.post("/v1/study/cards/:id/suspend", async (req) => {
      const a = await ctx.actor(req, "content:write");
      const { id } = parse(z.object({ id: z.uuid() }), req.params);
      const body = parse(suspendBody, req.body);
      const card = await readableCard(a, id);
      await setFlag(a.userId, card.id, card.archive_id, { suspended: body.suspended });
      return { cardId: card.id, suspended: body.suspended };
    });

    /** Hide a card until the start of tomorrow (your time zone), for a card you cannot face today. */
    r.post("/v1/study/cards/:id/bury", async (req) => {
      const a = await ctx.actor(req, "content:write");
      const { id } = parse(z.object({ id: z.uuid() }), req.params);
      const body = parse(buryBody, req.body ?? {});
      const card = await readableCard(a, id);
      const zone = await resolveZone(pool, body.tz);
      const { rows } = await pool.query("SELECT ((date_trunc('day', $1::timestamptz AT TIME ZONE $2) + interval '1 day') AT TIME ZONE $2) AS until", [ctx.now(), zone]);
      await setFlag(a.userId, card.id, card.archive_id, { buriedUntil: rows[0].until });
      return { cardId: card.id, buriedUntil: new Date(rows[0].until).toISOString() };
    });

    /** Your suspended cards, so you can bring them back. */
    r.get("/v1/study/suspended", async (req) => {
      const a = await ctx.actor(req, "content:read");
      const { rows } = await pool.query(
        `SELECT c.id, c.front, d.title AS deck, d.id AS deck_id, m.title AS course, COALESCE(st.lapses, 0) AS lapses
           FROM content.card_flags f
           JOIN content.cards c ON c.id = f.card_id
           JOIN content.sub_items d ON d.id = c.deck_id AND d.deleted_at IS NULL
           JOIN content.master_items m ON m.id = f.archive_id AND m.deleted_at IS NULL
           LEFT JOIN content.srs_state st ON st.user_id = f.user_id AND st.card_id = c.id
          WHERE f.user_id = $1 AND f.suspended ORDER BY m.title, d.title, c.ord LIMIT 500`,
        [a.userId],
      );
      return { cards: rows.map((x) => ({ id: x.id, front: x.front, deckId: x.deck_id, deck: x.deck, course: x.course, lapses: x.lapses })) };
    });

    /**
     * What your current cards would cost each day at different desired retentions, so the setting can be chosen
     * with eyes open. Each learned card is reviewed about once per interval, so its daily load is 1 / interval.
     */
    r.get("/v1/study/workload", async (req) => {
      const a = await ctx.actor(req, "content:read");
      const q = parse(z.object({ archive: z.uuid().optional() }), req.query);
      const s = await settings(a.userId);
      const { rows } = await pool.query(
        `SELECT st.stability FROM content.srs_state st
          WHERE st.user_id = $1 AND st.state = ${State.Review} AND st.stability > 0 AND ($2::uuid IS NULL OR st.archive_id = $2)
            AND NOT EXISTS (SELECT 1 FROM content.card_flags f WHERE f.user_id = st.user_id AND f.card_id = st.card_id AND f.suspended)`,
        [a.userId, q.archive ?? null],
      );
      const stabilities = rows.map((x) => Number(x.stability));
      const options = [0.8, 0.85, 0.9, 0.95].map((retention) => ({ retention, reviewsPerDay: Math.round(workload(stabilities, retention) * 10) / 10 }));
      if (!options.some((o) => o.retention === s.desiredRetention)) options.push({ retention: s.desiredRetention, reviewsPerDay: Math.round(workload(stabilities, s.desiredRetention) * 10) / 10 });
      options.sort((x, y) => x.retention - y.retention);
      return { cards: stabilities.length, current: s.desiredRetention, options };
    });

    /** One card's schedule and your review history of it, for working out why it keeps coming back. */
    r.get("/v1/study/cards/:id/history", async (req) => {
      const a = await ctx.actor(req, "content:read");
      const { id } = parse(z.object({ id: z.uuid() }), req.params);
      const card = await readableCard(a, id);
      const p = params(await settings(a.userId));
      const { rows: st } = await pool.query("SELECT * FROM content.srs_state WHERE user_id = $1 AND card_id = $2", [a.userId, card.id]);
      const { rows: rv } = await pool.query(
        "SELECT rating, state_before, elapsed_days, scheduled_days, duration_ms, reviewed_at FROM content.srs_reviews WHERE user_id = $1 AND card_id = $2 ORDER BY reviewed_at DESC LIMIT 100",
        [a.userId, card.id],
      );
      const nowMs = ctx.now().getTime();
      const cur = st[0] ? toState(st[0]) : null;
      return {
        cardId: card.id,
        deck: card.deck_title,
        schedule: cur && {
          state: cur.state,
          reps: cur.reps,
          lapses: cur.lapses,
          stabilityDays: Math.round(cur.stability * 10) / 10,
          difficulty: Math.round(cur.difficulty * 10) / 10,
          due: new Date(cur.due).toISOString(),
          recallChance: cur.lastReview === null ? null : Math.round(retrievability(cur.stability, (nowMs - cur.lastReview) / 86_400_000) * 1000) / 1000,
          desiredRetention: p.desiredRetention,
        },
        reviews: rv.map((x) => ({ rating: x.rating, wasNew: x.state_before === 0, daysSincePrevious: x.elapsed_days === null ? null : Math.round(x.elapsed_days * 10) / 10, scheduledDays: x.scheduled_days, seconds: Math.round(x.duration_ms / 1000), at: new Date(x.reviewed_at).toISOString() })),
      };
    });

    /** Undo your most recent review of a card: restores the schedule it replaced and removes the log row. */
    r.post("/v1/study/review/undo", async (req) => {
      const a = await ctx.actor(req, "content:write");
      const body = parse(undoBody, req.body);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const { rows } = await client.query("SELECT * FROM content.srs_reviews WHERE id = $1 AND user_id = $2 FOR UPDATE", [body.reviewId, a.userId]);
        const rev = rows[0];
        if (!rev) throw new HttpError(404, "not_found");
        const { rows: newer } = await client.query("SELECT 1 FROM content.srs_reviews WHERE user_id = $1 AND card_id = $2 AND reviewed_at > $3 LIMIT 1", [a.userId, rev.card_id, rev.reviewed_at]);
        if (newer.length) throw new HttpError(409, "cannot_undo", { reason: "The card has been reviewed again since." });
        // A first review has no earlier schedule (prev_state is null); an older review without one cannot be restored.
        if (!rev.prev_state && rev.state_before !== 0) throw new HttpError(409, "cannot_undo", { reason: "This review was made before undo existed." });
        if (rev.prev_state) {
          const p = rev.prev_state as CardState;
          await client.query("UPDATE content.srs_state SET state = $3, stability = $4, difficulty = $5, reps = $6, lapses = $7, last_review = $8, due = $9 WHERE user_id = $1 AND card_id = $2", [
            a.userId, rev.card_id, p.state, p.stability, p.difficulty, p.reps, p.lapses, p.lastReview === null ? null : new Date(p.lastReview), new Date(p.due),
          ]);
        } else {
          await client.query("DELETE FROM content.srs_state WHERE user_id = $1 AND card_id = $2", [a.userId, rev.card_id]);
        }
        await client.query("DELETE FROM content.srs_reviews WHERE id = $1", [rev.id]);
        await client.query("COMMIT");
        return { undone: true, cardId: rev.card_id };
      } catch (e) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw e;
      } finally {
        client.release();
      }
    });

    /** Your own review history as CSV, newest first (capped at 100,000 rows). */
    r.get("/v1/study/export", async (req, reply) => {
      const a = await ctx.actor(req, "content:read");
      const { rows } = await pool.query(
        `SELECT v.reviewed_at, v.rating, v.state_before, v.scheduled_days, v.duration_ms, c.front, d.title AS deck, m.title AS course
           FROM content.srs_reviews v
           LEFT JOIN content.cards c ON c.id = v.card_id
           LEFT JOIN content.sub_items d ON d.id = c.deck_id
           LEFT JOIN content.master_items m ON m.id = v.archive_id
          WHERE v.user_id = $1 ORDER BY v.reviewed_at DESC LIMIT 100000`,
        [a.userId],
      );
      // A cell starting with = + - or @ would run as a formula in a spreadsheet, so it gets a leading apostrophe.
      const safe = (v: string) => csvField(/^[=+\-@]/.test(v) ? `'${v}` : v);
      const head = "reviewed_at,course,deck,card,rating,was_new,scheduled_days,seconds";
      const lines = rows.map((x) =>
        [new Date(x.reviewed_at).toISOString(), safe(x.course ?? ""), safe(x.deck ?? ""), safe(x.front ?? ""), x.rating, x.state_before === 0 ? "yes" : "no", Math.round(x.scheduled_days * 100) / 100, Math.round(x.duration_ms / 100) / 10].join(","),
      );
      return reply.header("content-type", "text/csv; charset=utf-8").header("content-disposition", 'attachment; filename="ultimyr-review-history.csv"').send([head, ...lines].join("\n") + "\n");
    });

    /** Cards due now, counted per course, for the dashboard. Courses with nothing due are left out. */
    r.get("/v1/study/due", async (req) => {
      const a = await ctx.actor(req, "content:read");
      const { rows } = await pool.query(`SELECT archive_id, count(*)::int AS due FROM content.srs_state st WHERE user_id = $1 AND due <= $2 AND ${AWAKE("st.card_id", "$1", "$2")} GROUP BY archive_id`, [a.userId, ctx.now()]);
      return { byCourse: Object.fromEntries(rows.map((x) => [x.archive_id, x.due])) };
    });

    /** Flashcard reviews per calendar day (in the caller's `tz`, UTC if none) for the activity grid on the progress page. Days without reviews are left out. */
    r.get("/v1/study/activity", async (req) => {
      const a = await ctx.actor(req, "content:read");
      const q = parse(z.object({ archive: z.uuid().optional(), days: z.coerce.number().int().min(7).max(366).default(84), tz: z.string().max(64).optional() }), req.query);
      const now = ctx.now();
      const zone = await resolveZone(pool, q.tz);
      const { rows } = await pool.query(
        `SELECT to_char(reviewed_at AT TIME ZONE $5, 'YYYY-MM-DD') AS date, count(*)::int AS reviews
           FROM content.srs_reviews
          WHERE user_id = $1 AND ($2::uuid IS NULL OR archive_id = $2) AND reviewed_at >= (date_trunc('day', $3::timestamptz AT TIME ZONE $5) - make_interval(days => $4::int - 1)) AT TIME ZONE $5
          GROUP BY 1 ORDER BY 1`,
        [a.userId, q.archive ?? null, now, q.days, zone],
      );
      return { days: q.days, activity: rows };
    });

    /** Counts, retention and a seven day forecast for the progress page. */
    r.get("/v1/study/stats", async (req) => {
      const a = await ctx.actor(req, "content:read");
      const { archive, deck, tz } = parse(z.object({ archive: z.uuid().optional(), deck: z.uuid().optional(), tz: z.string().max(64).optional() }), req.query);
      const zone = await resolveZone(pool, tz);
      const now = ctx.now();
      const args = [a.userId, archive ?? null, now, zone];
      // `deck` narrows the card counts only (learning, review, due now); reviews and the forecast stay per course.
      const { rows: st } = await pool.query(
        `SELECT count(*) FILTER (WHERE state = 1 OR state = 3)::int AS learning, count(*) FILTER (WHERE state = 2)::int AS review,
                count(*) FILTER (WHERE due <= $3 AND NOT EXISTS (SELECT 1 FROM content.card_flags f WHERE f.user_id = $1 AND f.card_id = st.card_id AND (f.suspended OR f.buried_until > $3)))::int AS due_now
           FROM content.srs_state st WHERE user_id = $1 AND ($2::uuid IS NULL OR archive_id = $2) AND ($4::uuid IS NULL OR deck_id = $4)`,
        [a.userId, archive ?? null, now, deck ?? null],
      );
      const { rows: rv } = await pool.query(
        `SELECT count(*) FILTER (WHERE reviewed_at >= date_trunc('day', $3::timestamptz AT TIME ZONE $4) AT TIME ZONE $4)::int AS today,
                count(*) FILTER (WHERE state_before IN (2, 3) AND reviewed_at >= $3::timestamptz - interval '30 days')::int AS recalls,
                count(*) FILTER (WHERE state_before IN (2, 3) AND rating > 1 AND reviewed_at >= $3::timestamptz - interval '30 days')::int AS recalled
           FROM content.srs_reviews WHERE user_id = $1 AND ($2::uuid IS NULL OR archive_id = $2)`,
        args,
      );
      const { rows: fc } = await pool.query(
        `SELECT (floor(extract(epoch FROM (due - (date_trunc('day', $3::timestamptz AT TIME ZONE $4) AT TIME ZONE $4))) / 86400))::int AS day, count(*)::int AS n
           FROM content.srs_state WHERE user_id = $1 AND ($2::uuid IS NULL OR archive_id = $2) AND due >= $3::timestamptz AND due < (date_trunc('day', $3::timestamptz AT TIME ZONE $4) + interval '7 days') AT TIME ZONE $4
          GROUP BY 1 ORDER BY 1`,
        args,
      );
      const forecast = Array.from({ length: 7 }, (_, d) => fc.find((x) => x.day === d)?.n ?? 0);
      return {
        learning: st[0].learning,
        review: st[0].review,
        dueNow: st[0].due_now,
        reviewedToday: rv[0].today,
        retentionBp: rv[0].recalls ? Math.round((rv[0].recalled * 10_000) / rv[0].recalls) : null,
        recalls30d: rv[0].recalls,
        forecast,
      };
    });
  };
}
