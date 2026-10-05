import { nodeFor } from "@ultimyr/tagging/nodes";

/**
 * The shapes of the bundled Lucide icons, so any icon can be drawn without shipping the whole set to every page.
 * GET /api/icons?names=bot,network returns { bot: [...], network: [...] } (null for a name that is not in the library).
 * The library version is pinned, so the answer never changes between releases of the same build and is cached hard.
 */
export function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("names") ?? "";
  const names = [...new Set(raw.split(",").map((n) => n.trim()).filter((n) => /^[a-z0-9-]{1,60}$/.test(n)))].slice(0, 60);
  const out: Record<string, unknown> = {};
  for (const n of names) out[n] = nodeFor(n);
  return Response.json(out, { headers: { "Cache-Control": "public, max-age=31536000, immutable" } });
}
