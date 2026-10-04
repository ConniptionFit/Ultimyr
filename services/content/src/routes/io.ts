import { HttpError, idParam, parse } from "@ultimyr/service-kit";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { RANK, loadArchive, loadItem, need } from "../access.js";
import type { Ctx } from "../ctx.js";
import { normalizeUrl } from "../links.js";
import { csvField, parseCsv } from "../markdown.js";
import { createArchive, createArchiveBody } from "./archives.js";
import { MAX_CARDS, MAX_MARKDOWN, cardInput, createItem, itemDetail } from "./items.js";
import { buildRoadmap, resourceInput, saveRoadmap, upsertResource, type RoadmapInput } from "./roadmap.js";

const MAX_IMPORT_ITEMS = 200;
const safeNormalize = (u: string) => {
  try {
    return normalizeUrl(u);
  } catch {
    return u;
  }
};
const fileStepFields = {
  itemIndex: z.number().int().min(0).optional(),
  resourceUrl: z.string().max(2000).optional(),
  milestone: z.string().trim().min(1).max(160).optional(),
  note: z.string().max(1000).default(""),
  required: z.boolean().default(true),
  minutes: z.number().int().min(1).max(6000).nullable().optional(),
};
const fileStepLeaf = z.object(fileStepFields);
const fileStepMid = z.object({ ...fileStepFields, steps: z.array(fileStepLeaf).max(60).optional() });
const fileStepTop = z.object({ ...fileStepFields, steps: z.array(fileStepMid).max(60).optional() });
type FileStep = z.infer<typeof fileStepTop>;

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
  resources: z.array(resourceInput).max(500).optional(),
  // Steps point at items by position in `items` and at resources by link, so the file carries no database ids.
  roadmap: z
    .object({
      summary: z.string().max(2000).default(""),
      stages: z.array(z.object({ title: z.string().trim().min(1).max(160), summary: z.string().max(1000).default(""), steps: z.array(fileStepTop).max(60) })).max(30),
    })
    .optional(),
});

const importBody = z.discriminatedUnion("format", [
  z.object({ format: z.literal("archive-json"), content: z.union([archiveDoc, z.string().max(20_000_000)]) }),
  z.object({ format: z.literal("markdown"), archiveId: z.uuid(), title: z.string().trim().min(1).max(160).optional(), content: z.string().min(1).max(MAX_MARKDOWN) }),
  z.object({ format: z.literal("anki-csv"), archiveId: z.uuid(), title: z.string().trim().min(1).max(160), content: z.string().min(1).max(5_000_000) }),
]);

const exportQuery = z.object({ format: z.enum(["json", "markdown", "anki-csv"]).default("json") });

export function ioRoutes(ctx: Ctx) {
  const { pool } = ctx;

  /** The roadmap without ids or progress. Steps on quizzes are left out because quizzes are not part of this file. */
  async function exportRoadmap(userId: string, archiveId: string, rel: number, indexOf: Map<string, number>) {
    const v = await buildRoadmap(pool, userId, archiveId, rel);
    if (!v.exists) return undefined;
    // An item that is not part of this file (a quiz) stays on the path as a plain checkpoint, so the structure survives.
    const fileStep = (x: Record<string, any>): FileStep => {
      const common = { note: x.note, required: x.required, minutes: x.minutes ?? undefined };
      const kids = x.children.length ? { steps: x.children.map(fileStep) } : {};
      if (x.kind === "milestone") return { milestone: x.title, ...common, ...kids };
      if (x.kind === "resource") return { resourceUrl: x.resource.url, ...common, ...kids };
      const i = indexOf.get(x.item.id);
      return i === undefined ? { milestone: x.item.title.slice(0, 160), ...common, ...kids } : { itemIndex: i, ...common, ...kids };
    };
    return {
      summary: v.summary,
      stages: v.stages.map((st) => ({
        title: st.title,
        summary: st.summary,
        steps: st.steps.map(fileStep),
      })),
    };
  }

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
      const indexOf = new Map<string, number>();
      for (const s of items) {
        indexOf.set(s.id, out.length);
        const d = await itemDetail(pool, s, rel);
        out.push({ kind: s.kind, title: s.title, summary: s.summary, ...(s.kind === "guide" ? { markdown: d.markdown } : { cards: d.cards.map((c: any) => ({ front: c.front, back: c.back, hint: c.hint, tags: c.tags })) }) });
      }
      const doc = {
        format: "ultimyr-archive",
        version: 1,
        archive: { title: row.title, overview: row.overview, vendor: row.vendor, purchaseLinks: row.purchase_links, validityMonths: row.validity_months, quickStats: row.quick_stats, iconName: row.icon_name, tags: row.tags },
        items: out,
        resources: (await pool.query("SELECT kind, title, url, summary, minutes, tags FROM content.resources WHERE master_item_id = $1 AND (status = 'published' OR $2::boolean) ORDER BY ord, created_at", [row.id, rel >= RANK.editor])).rows,
        roadmap: await exportRoadmap(a.userId, row.id, rel, indexOf),
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
        const itemIds: string[] = [];
        for (const it of doc.items) itemIds.push((await createItem(pool, archive.id, a.userId, { kind: it.kind, title: it.title, summary: it.summary, markdown: it.kind === "guide" ? (it.markdown ?? "") : undefined, cards: it.kind === "deck" ? (it.cards ?? []) : undefined, source: "import", status: "published" })).id);
        const resourceIds = new Map<string, string>();
        for (const res of doc.resources ?? []) {
          const { row } = await upsertResource(pool, archive.id, a.userId, res, "import", "published");
          resourceIds.set(row.url, row.id);
        }
        if (doc.roadmap) {
          const toStep = (x: FileStep): RoadmapInput["stages"][number]["steps"][number] => {
            const common = { note: x.note, required: x.required, minutes: x.minutes };
            const kids = x.steps?.length ? { steps: x.steps.map(toStep as never) as never } : {};
            if (x.milestone) return { milestone: x.milestone, ...common, ...kids } as never;
            if (x.itemIndex !== undefined && itemIds[x.itemIndex]) return { itemId: itemIds[x.itemIndex], ...common, ...kids } as never;
            const id = x.resourceUrl ? resourceIds.get(safeNormalize(x.resourceUrl)) : undefined;
            // A step that points at nothing we can find keeps its place as a checkpoint rather than dropping its children.
            return id ? ({ resourceId: id, ...common, ...kids } as never) : ({ milestone: (x.resourceUrl ?? "Checkpoint").slice(0, 160), ...common, ...kids } as never);
          };
          const stages: RoadmapInput["stages"] = doc.roadmap.stages.map((st) => ({ title: st.title, summary: st.summary, steps: st.steps.map(toStep) }));
          await saveRoadmap(pool, archive.id, a.userId, { summary: doc.roadmap.summary, stages, source: "import", status: "published" });
        }
        return reply.code(201).send({ archiveId: archive.id, items: doc.items.length, resources: resourceIds.size });
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
