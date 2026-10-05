import { HttpError, idParam, parse } from "@ultimyr/service-kit";
import { ICON_COUNT, LUCIDE_VERSION, MAX_TAGS_PER_TARGET, NAMESPACES, TAG_PATTERN, VOCABULARY, hasIcon, iconInfo, normalizeTags, searchIcons, suggestIcons } from "@ultimyr/tagging";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { RANK, loadArchive, need } from "../access.js";
import type { Ctx } from "../ctx.js";
import { ICON_KINDS, TARGET_KINDS, autoAssignIcons, describeTargets, loadModel, setIcons, setTags, suggestionsFor, tagSummary } from "../tagging.js";

const MAX_TARGETS = 300;
const tagList = z.array(z.string().trim().min(1).max(81)).max(MAX_TAGS_PER_TARGET);
const setTagsBody = z.object({ targets: z.array(z.object({ kind: z.enum(TARGET_KINDS), id: z.uuid(), tags: tagList })).min(1).max(MAX_TARGETS) });
const setIconsBody = z.object({ targets: z.array(z.object({ kind: z.enum(ICON_KINDS), id: z.uuid(), icon: z.string().max(80).nullable() })).min(1).max(MAX_TARGETS) });
const limitQ = z.coerce.number().int().min(1).max(200);

export function taggingRoutes(ctx: Ctx) {
  const { pool } = ctx;
  return async (r: FastifyInstance) => {
    async function archiveFor(req: Parameters<typeof idParam>[0], scope: "content:read" | "content:write", min: number) {
      const a = await ctx.actor(req, scope);
      const loaded = await loadArchive(pool, a, idParam(req));
      need(loaded.rel, min);
      return { a, ...loaded };
    }

    // ---- the shared vocabulary and the icon library (not tied to any archive) ----
    r.get("/v1/tags/vocabulary", async (req) => {
      await ctx.actor(req, "content:read");
      return {
        tagPattern: TAG_PATTERN.source,
        note: "A tag is namespace:value in lower case. Other namespaces are allowed and kept, but only the ones below affect icon suggestions. Bare words are matched to the vocabulary (ai, video, networking).",
        namespaces: (Object.keys(NAMESPACES) as Array<keyof typeof NAMESPACES>).map((ns) => ({
          namespace: ns,
          label: NAMESPACES[ns].label,
          description: NAMESPACES[ns].description,
          iconWeight: NAMESPACES[ns].weight,
          values: Object.entries(VOCABULARY[ns]).map(([value, d]) => ({ tag: `${ns}:${value}`, label: d.label, synonyms: d.synonyms, icons: d.icons })),
        })),
      };
    });

    r.get("/v1/icons", async (req) => {
      await ctx.actor(req, "content:read");
      const q = parse(z.object({ query: z.string().trim().max(80).default(""), tag: z.string().trim().max(81).optional(), limit: limitQ.default(48), offset: z.coerce.number().int().min(0).max(100_000).default(0) }), req.query);
      const tag = q.tag ? normalizeTags([q.tag])[0] : undefined;
      if (q.tag && !tag) throw new HttpError(400, "invalid_request", { issues: [`tag: "${q.tag}" is not a usable tag`] });
      return { lucideVersion: LUCIDE_VERSION, totalInLibrary: ICON_COUNT, ...searchIcons(q.query, { limit: q.limit, offset: q.offset, tag }) };
    });

    r.get("/v1/icons/:name", async (req) => {
      await ctx.actor(req, "content:read");
      const { name } = parse(z.object({ name: z.string().max(80) }), req.params);
      const info = iconInfo(name);
      if (!info) throw new HttpError(404, "not_found");
      return info;
    });

    /** Rank icons for any tag list, without an archive. Weights are optional (default 1). */
    r.post("/v1/icons/suggest", async (req) => {
      await ctx.actor(req, "content:read");
      const body = parse(z.object({ tags: z.array(z.union([z.string().max(81), z.object({ tag: z.string().max(81), weight: z.number().min(0).max(1).default(1) })])).min(1).max(60), limit: limitQ.default(8) }), req.body);
      return { suggestions: suggestIcons(body.tags, { limit: body.limit }) };
    });

    // ---- an archive's tags ----
    r.get("/v1/archives/:id/tags", async (req) => {
      const { rel, row } = await archiveFor(req, "content:read", RANK.viewer);
      const q = parse(z.object({ kind: z.enum(TARGET_KINDS).optional(), tag: z.string().trim().max(81).optional() }), req.query);
      const model = await loadModel(pool, row, rel >= RANK.editor);
      const all = describeTargets(model);
      const tag = q.tag ? normalizeTags([q.tag])[0] : undefined;
      return { archiveId: row.id, summary: tagSummary(all), targets: describeTargets(model, { kind: q.kind, tag }) };
    });

    /** Set the exact tags on each target. Icons that were not chosen by a person are re-picked from the new tags. */
    r.put("/v1/archives/:id/tags", async (req) => {
      const { row } = await archiveFor(req, "content:write", RANK.editor);
      const body = parse(setTagsBody, req.body);
      const stored = await setTags(pool, row.id, body.targets);
      const iconChanges = await autoAssignIcons(pool, row);
      return { stored, iconChanges };
    });

    // ---- icons on an archive ----
    r.get("/v1/archives/:id/icon-suggestions", async (req) => {
      const { rel, row } = await archiveFor(req, "content:read", RANK.viewer);
      const q = parse(z.object({ kind: z.enum(ICON_KINDS).default("archive"), id: z.uuid().optional(), limit: limitQ.default(8) }), req.query);
      const model = await loadModel(pool, row, rel >= RANK.editor);
      return suggestionsFor(model, q.kind, q.id ?? row.id, q.limit);
    });

    /** A person's icon choice for archive, stage or step. `icon: null` hands it back to automatic assignment. */
    r.put("/v1/archives/:id/icons", async (req) => {
      const { row } = await archiveFor(req, "content:write", RANK.editor);
      const body = parse(setIconsBody, req.body);
      for (const t of body.targets) if (t.icon !== null && !hasIcon(t.icon)) throw new HttpError(400, "invalid_request", { issues: [`icon "${t.icon}" is not in the Lucide library`] });
      await setIcons(pool, row, body.targets);
      const { rows } = await pool.query("SELECT * FROM content.master_items WHERE id = $1", [row.id]);
      const iconChanges = await autoAssignIcons(pool, rows[0]!);
      return { updated: body.targets.length, iconChanges };
    });

    /** Re-run automatic assignment for the whole archive. Never changes an icon a person chose. */
    r.post("/v1/archives/:id/icons/auto", async (req) => {
      const { row } = await archiveFor(req, "content:write", RANK.editor);
      return { iconChanges: await autoAssignIcons(pool, row) };
    });
  };
}
