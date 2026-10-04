import { HttpError } from "@ultimyr/service-kit";

/** What the content service says about the caller and a quiz item. */
export interface ItemAccess {
  kind: string;
  archiveId: string;
  status: string;
  canAttempt: boolean;
  canWrite: boolean;
}

/** Looks up the caller's rights on a content item. Injected so tests need no content service. */
export interface AccessChecker {
  item(bearer: string, itemId: string): Promise<ItemAccess | null>;
}

export function httpAccessChecker(contentUrl: string, timeoutMs = 3000): AccessChecker {
  return {
    async item(bearer, itemId) {
      let res: Response;
      try {
        res = await fetch(`${contentUrl}/v1/access/item/${itemId}`, { headers: { authorization: `Bearer ${bearer}` }, signal: AbortSignal.timeout(timeoutMs) });
      } catch {
        throw new HttpError(503, "content_unavailable");
      }
      if (res.status === 404 || res.status === 403) return null;
      if (res.status === 401) throw new HttpError(401, "unauthenticated");
      if (!res.ok) throw new HttpError(503, "content_unavailable");
      const j = (await res.json()) as Record<string, any>;
      return { kind: j.kind, archiveId: j.archiveId, status: j.status, canAttempt: !!j.canAttempt, canWrite: !!j.canWrite };
    },
  };
}
