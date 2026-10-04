import { HttpError } from "@ultimyr/service-kit";

/** What the content service says about the caller and a quiz item. */
export interface ItemAccess {
  kind: string;
  archiveId: string;
  status: string;
  canAttempt: boolean;
  canWrite: boolean;
}

/** What the content service says about the caller and an archive: the quizzes in it they may attempt. */
export interface ArchiveAccess {
  canRead: boolean;
  canWrite: boolean;
  quizzes: Array<{ id: string; title: string; status: string; canAttempt: boolean; canWrite: boolean }>;
}

/** Looks up the caller's rights on a content item or archive. Injected so tests need no content service. */
export interface AccessChecker {
  item(bearer: string, itemId: string): Promise<ItemAccess | null>;
  archive(bearer: string, archiveId: string): Promise<ArchiveAccess | null>;
}

export function httpAccessChecker(contentUrl: string, timeoutMs = 3000): AccessChecker {
  async function get(bearer: string, path: string): Promise<Record<string, any> | null> {
    let res: Response;
    try {
      res = await fetch(`${contentUrl}${path}`, { headers: { authorization: `Bearer ${bearer}` }, signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      throw new HttpError(503, "content_unavailable");
    }
    if (res.status === 404 || res.status === 403) return null;
    if (res.status === 401) throw new HttpError(401, "unauthenticated");
    if (!res.ok) throw new HttpError(503, "content_unavailable");
    return (await res.json()) as Record<string, any>;
  }
  return {
    async archive(bearer, archiveId) {
      const j = await get(bearer, `/v1/access/archive/${archiveId}`);
      if (!j) return null;
      const quizzes = Array.isArray(j.quizzes) ? j.quizzes : [];
      return {
        canRead: !!j.canRead,
        canWrite: !!j.canWrite,
        quizzes: quizzes.map((q: Record<string, any>) => ({ id: String(q.id), title: String(q.title ?? ""), status: String(q.status), canAttempt: !!q.canAttempt, canWrite: !!q.canWrite })),
      };
    },
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
