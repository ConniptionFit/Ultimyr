import { HttpError, idParam, parse } from "@ultimyr/service-kit";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { RANK, loadArchive, loadItem, need } from "../access.js";
import type { Ctx } from "../ctx.js";
import { csvField, parseCsv } from "../markdown.js";
import { createArchive, createArchiveBody } from "./archives.js";
import { MAX_CARDS, MAX_MARKDOWN, cardInput, createItem, itemDetail } from "./items.js";

const MAX_IMPORT_ITEMS = 200;
const archiveDoc = z.object({
  format: z.literal("ultimyr-archive"),
  version: z.literal(1),
  archive: createArchiveBody.omit({ slug: true, scoringProfileId: true, visibility: true }),
  items: z
    .array(
      z.object({
        kind: z.enum(["guide", "deck"]),
        title: z.string().trim().min(1).max(160),
        summary: z.string().max(2000).default(""),
        markdown: z.string().max(MAX_MARKDOWN).optional(),
        cards: z.array(cardInput).max(MAX_CARDS).optional(),
      }),
    )
    .max(MAX_IMPORT_ITEMS),
});

const importBody = z.discriminatedUnion("format", [
  z.object({ format: z.literal("archive-json"), content: z.union([archiveDoc, z.string().max(20_000_000)]) }),
  z.object({ format: z.literal("markdown"), archiveId: z.uuid(), title: z.string().trim().min(1).max(160).optional(), content: z.string().min(1).max(MAX_MARKDOWN) }),
  z.object({ format: z.literal("anki-csv"), archiveId: z.uuid(), title: z.string().trim().min(1).max(160), content: z.string().min(1).max(5_000_000) }),
]);

const exportQuery = z.object({ format: z.enum(["json", "markdown", "anki-csv"]).default("json") });

export function ioRoutes(ctx: Ctx) {
  const { pool } = ctx;
  return async (r: FastifyInstance) => {
    r.get("/v1/archives/:id/export", async (req, reply) => {
      const a = await ctx.actor(req, "content:read");
      const { rel, row } = await loadArchive(pool, a, idParam(req));
      need(rel, RANK.viewer);
      const { rows: items } = await pool.query(
        "SELECT s.* , m.title AS archive_title FROM content.sub_items s JOIN content.master_items m ON m.id = s.master_item_id WHERE s.master_item_id = $1 AND s.deleted_at IS NULL AND s.kind <> 'quiz' AND (s.status = 'published' OR $2::boolean) ORDER BY s.ord, s.created_at",
        [row.id, rel >= RANK.editor],
      );
      const out = [];
      for (const s of items) {
        const d = await itemDetail(pool, s, rel);
        out.push({ kind: s.kind, title: s.title, summary: s.summary, ...(s.kind === "guide" ? { markdown: d.markdown } : { cards: d.cards.map((c: any) => ({ front: c.front, back: c.back, hint: c.hint, tags: c.tags })) }) });
      }
      const doc = {
        format: "ultimyr-archive",
        version: 1,
        archive: { title: row.title, overview: row.overview, vendor: row.vendor, purchaseLinks: row.purchase_links, validityMonths: row.validity_months, quickStats: row.quick_stats, iconName: row.icon_name, tags: row.tags },
        items: out,
      };
      return reply.header("content-disposition", `attachment; filename="${row.slug}.ultimyr.json"`).send(doc);
    });

    r.get("/v1/items/:id/export", async (req, reply) => {
      const a = await ctx.actor(req, "content:read");
      const { rel, row } = await loadItem(pool, a, idParam(req));
      need(rel, RANK.viewer);
      const { format } = parse(exportQuery, req.query);
      const d = await itemDetail(pool, row, rel);
      const name = row.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "item";
      if (row.kind === "quiz") throw new HttpError(400, "unsupported_export", { reason: "Quiz export is handled by the quiz service." });
      if (format === "json") return reply.header("content-disposition", `attachment; filename="${name}.json"`).send({ kind: row.kind, title: row.title, summary: row.summary, ...(row.kind === "guide" ? { markdown: d.markdown } : { cards: d.cards }) });
      if (format === "markdown") {
        const text = row.kind === "guide" ? d.markdown : `# ${row.title}\n\n` + d.cards.map((c: any) => `**Q:** ${c.front}\n\n**A:** ${c.back}\n`).join("\n");
        return reply.header("content-type", "text/markdown; charset=utf-8").header("content-disposition", `attachment; filename="${name}.md"`).send(text);
      }
      if (row.kind !== "deck") throw new HttpError(400, "unsupported_export", { reason: "Only decks export as Anki CSV." });
      const csv = d.cards.map((c: any) => [csvField(c.front), csvField(c.back), csvField((c.tags ?? []).join(" "))].join(",")).join("\n") + "\n";
      return reply.header("content-type", "text/csv; charset=utf-8").header("content-disposition", `attachment; filename="${name}.csv"`).send(csv);
    });

    r.post("/v1/import", { bodyLimit: 25 * 1024 * 1024 }, async (req, reply) => {
      const a = await ctx.actor(req, "content:write");
      const body = parse(importBody, req.body);

      if (body.format === "archive-json") {
        ctx.requireAuthor(a);
        let doc: z.infer<typeof archiveDoc>;
        if (typeof body.content === "string") {
          let raw: unknown;
          try {
            raw = JSON.parse(body.content);
          } catch {
            throw new HttpError(400, "invalid_request", { issues: ["content: not valid JSON"] });
          }
          doc = parse(archiveDoc, raw);
        } else doc = body.content;
        const archive = await createArchive(pool, a.userId, { ...doc.archive, overview: doc.archive.overview ?? "" });
        for (const it of doc.items) await createItem(pool, archive.id, a.userId, { kind: it.kind, title: it.title, summary: it.summary, markdown: it.kind === "guide" ? (it.markdown ?? "") : undefined, cards: it.kind === "deck" ? (it.cards ?? []) : undefined, source: "import", status: "published" });
        return reply.code(201).send({ archiveId: archive.id, items: doc.items.length });
      }

      const { rel, row } = await loadArchive(pool, a, body.archiveId);
      need(rel, RANK.editor);
      if (body.format === "markdown") {
        const title = body.title ?? /^#\s+(.+)$/m.exec(body.content)?.[1]?.trim() ?? "Imported guide";
        const item = await createItem(pool, row.id, a.userId, { kind: "guide", title: title.slice(0, 160), summary: "", markdown: body.content, source: "import", status: "published" });
        return reply.code(201).send({ itemId: item.id });
      }
      const rows = parseCsv(body.content);
      const cards = rows
        .filter((c) => c[0]?.trim() && c[1]?.trim())
        .map((c) => ({ front: c[0]!.trim().slice(0, 5000), back: c[1]!.trim().slice(0, 10_000), tags: (c[2] ?? "").split(/\s+/).filter(Boolean).slice(0, 20) }));
      if (!cards.length) throw new HttpError(400, "invalid_request", { issues: ["content: no cards found (expected front and back columns)"] });
      if (cards.length > MAX_CARDS) throw new HttpError(409, "too_many_cards", { max: MAX_CARDS });
      const item = await createItem(pool, row.id, a.userId, { kind: "deck", title: body.title, summary: "", cards, source: "import", status: "published" });
      return reply.code(201).send({ itemId: item.id, cards: cards.length });
    });
  };
}
