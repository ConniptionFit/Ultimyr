import { HttpError } from "@ultimyr/service-kit";
import type { PlanInput, PlanStep } from "./plan.js";

/** Reads an archive and its roadmap from the content service as the caller, so access rules stay in one place. */
export interface ContentReader {
  plan(bearer: string, archiveId: string): Promise<PlanInput | null>;
}

export function httpContentReader(contentUrl: string, timeoutMs = 5000): ContentReader {
  async function get(bearer: string, path: string): Promise<any | null> {
    let res: Response;
    try {
      res = await fetch(`${contentUrl}${path}`, { headers: { authorization: `Bearer ${bearer}` }, signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      throw new HttpError(503, "content_unavailable");
    }
    if (res.status === 404 || res.status === 403) return null;
    if (res.status === 401) throw new HttpError(401, "unauthenticated");
    if (!res.ok) throw new HttpError(503, "content_unavailable");
    return res.json();
  }
  const toStep = (s: any): PlanStep => ({
    id: s.id,
    title: String(s.title ?? s.item?.title ?? s.resource?.title ?? "Step"),
    url: s.resource?.url ?? null,
    children: (s.children ?? []).map(toStep),
  });
  return {
    async plan(bearer, archiveId) {
      const archive = await get(bearer, `/v1/archives/${archiveId}`);
      if (!archive) return null;
      const roadmap = await get(bearer, `/v1/archives/${archiveId}/roadmap`);
      if (!roadmap?.exists) return null;
      return {
        archiveTitle: String(archive.title),
        slug: String(archive.slug),
        stages: roadmap.stages.map((st: any) => ({ title: String(st.title), steps: st.steps.map(toStep) })),
      };
    },
  };
}
