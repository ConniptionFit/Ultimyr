import { DEFAULT_W, State, newCard, preview, review, type CardState, type Params, type Rating } from "@ultimyr/fsrs";
import { HttpError, parse, uuidv7 } from "@ultimyr/service-kit";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ARCHIVE_REL, ITEM_GRANT, RANK, loadItem } from "../access.js";
import type { Ctx } from "../ctx.js";
import { csvField } from "../markdown.js";

const queueQuery = z.object({
  archive: z.uuid().optional(),
  deck: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
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
});

type Row = Record<string, any>;
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
    return { desiredRetention: rows[0]?.desired_retention ?? 0.9, newPerDay: rows[0]?.new_per_day ?? 20 };
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

  return async (r: FastifyInstance) => {
    r.get("/v1/study/settings", async (req) => settings((await ctx.actor(req, "content:read")).userId));

    r.put("/v1/study/settings", async (req) => {
      const a = await ctx.actor(req, "content:write");
      const body = parse(settingsBody, req.body);
      const cur = await settings(a.userId);
      const next = { desiredRetention: body.desiredRetention ?? cur.desiredRetention, newPerDay: body.newPerDay ?? cur.newPerDay };
      await pool.query(
        `INSERT INTO content.study_settings (user_id, desired_retention, new_per_day) VALUES ($1,$2,$3)
         ON CONFLICT (user_id) DO UPDATE SET desired_retention = $2, new_per_day = $3, updated_at = now()`,
        [a.userId, next.desiredRetention, next.newPerDay],
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
      const base = [a.userId, a.groups, q.archive ?? null, q.deck ?? null];
      const { rows: due } = await pool.query(
        `WITH ${ACC}, readable AS (${READABLE})
         SELECT r.*, st.state, st.stability, st.difficulty, st.reps, st.lapses, st.last_review, st.due
           FROM readable r JOIN content.srs_state st ON st.card_id = r.id AND st.user_id = $1
          WHERE st.due <= $5 ORDER BY st.due LIMIT $6`,
        [...base, now, q.limit],
      );
      const { rows: today } = await pool.query("SELECT count(*)::int AS n FROM content.srs_reviews WHERE user_id = $1 AND state_before = 0 AND reviewed_at >= date_trunc('day', $2::timestamptz)", [a.userId, now]);
      const room = Math.max(0, Math.min(s.newPerDay - today[0].n, q.limit - due.length));
      const { rows: fresh } = room
        ? await pool.query(
            `WITH ${ACC}, readable AS (${READABLE})
             SELECT r.* FROM readable r WHERE NOT EXISTS (SELECT 1 FROM content.srs_state st WHERE st.card_id = r.id AND st.user_id = $1)
              ORDER BY r.deck_id, r.ord, r.created_at LIMIT $5`,
            [...base, room],
          )
        : { rows: [] as Row[] };
      const nowMs = now.getTime();
      return {
        settings: s,
        counts: { due: due.length, new: fresh.length, newAllowanceLeft: Math.max(0, s.newPerDay - today[0].n) },
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
      return { reviewId, state: n.state, due: new Date(n.due).toISOString(), scheduledDays: out.scheduledDays, reps: n.reps, lapses: n.lapses };
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

    /** Counts, retention and a seven day forecast for the progress page. */
    r.get("/v1/study/stats", async (req) => {
      const a = await ctx.actor(req, "content:read");
      const { archive } = parse(z.object({ archive: z.uuid().optional() }), req.query);
      const now = ctx.now();
      const args = [a.userId, archive ?? null, now];
      const { rows: st } = await pool.query(
        `SELECT count(*) FILTER (WHERE state = 1 OR state = 3)::int AS learning, count(*) FILTER (WHERE state = 2)::int AS review,
                count(*) FILTER (WHERE due <= $3)::int AS due_now
           FROM content.srs_state WHERE user_id = $1 AND ($2::uuid IS NULL OR archive_id = $2)`,
        args,
      );
      const { rows: rv } = await pool.query(
        `SELECT count(*) FILTER (WHERE reviewed_at >= date_trunc('day', $3::timestamptz))::int AS today,
                count(*) FILTER (WHERE state_before IN (2, 3) AND reviewed_at >= $3::timestamptz - interval '30 days')::int AS recalls,
                count(*) FILTER (WHERE state_before IN (2, 3) AND rating > 1 AND reviewed_at >= $3::timestamptz - interval '30 days')::int AS recalled
           FROM content.srs_reviews WHERE user_id = $1 AND ($2::uuid IS NULL OR archive_id = $2)`,
        args,
      );
      const { rows: fc } = await pool.query(
        `SELECT (floor(extract(epoch FROM (due - date_trunc('day', $3::timestamptz))) / 86400))::int AS day, count(*)::int AS n
           FROM content.srs_state WHERE user_id = $1 AND ($2::uuid IS NULL OR archive_id = $2) AND due >= $3::timestamptz AND due < date_trunc('day', $3::timestamptz) + interval '7 days'
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
