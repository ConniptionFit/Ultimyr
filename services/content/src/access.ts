import { HttpError, type Pool, type Principal } from "@ultimyr/service-kit";

export const RANK = { none: 0, attempt: 1, viewer: 2, editor: 3, owner: 4 } as const;
export type Relation = "attempt" | "viewer" | "editor" | "owner";
export const RELATION_BY_RANK: Record<number, Relation | "none"> = { 0: "none", 1: "attempt", 2: "viewer", 3: "editor", 4: "owner" };

/** Where a user's group memberships come from. Production asks the auth service; tests pass a stub. */
export interface GroupResolver {
  groupsFor(principal: Principal, bearer: string): Promise<string[]>;
}

export function httpGroupResolver(authUrl: string, ttlMs = 30_000): GroupResolver {
  const cache = new Map<string, { at: number; ids: string[] }>();
  return {
    async groupsFor(p, bearer) {
      const hit = cache.get(p.userId);
      if (hit && Date.now() - hit.at < ttlMs) return hit.ids;
      try {
        const res = await fetch(`${authUrl}/v1/me/groups`, { headers: { authorization: `Bearer ${bearer}` }, signal: AbortSignal.timeout(3000) });
        if (!res.ok) throw new Error(String(res.status));
        const ids = ((await res.json()) as Array<{ id: string }>).map((g) => g.id);
        cache.set(p.userId, { at: Date.now(), ids });
        return ids;
      } catch {
        // Auth being down must not lock people out of what they own; group grants simply do not apply until it is back.
        return hit?.ids ?? [];
      }
    },
  };
}

/**
 * Curriculum admins have full access to every course. Instead of threading a flag through every query, the
 * actor's group list carries this reserved id (never a real group) and the SQL below reads it.
 */
export const CURATOR = "00000000-0000-4000-8000-00000000c0a0";
export const isCurator = (a: { groups: string[] }) => a.groups.includes(CURATOR);

export interface Actor {
  userId: string;
  groups: string[];
  principal: Principal;
}

/** SQL fragment: the relation rank a user holds on archive `m`, from ownership, visibility and grants. $1 = user id, $2 = group ids. */
export const ARCHIVE_REL = `GREATEST(
  CASE WHEN m.owner_id = $1 OR $2::uuid[] @> ARRAY['00000000-0000-4000-8000-00000000c0a0']::uuid[] THEN 4 ELSE 0 END,
  CASE WHEN m.visibility IN ('public', 'org') THEN 2 ELSE 0 END,
  COALESCE((SELECT max(g.rank) FROM content.grants g
            WHERE g.object_type = 'archive' AND g.object_id = m.id
              AND ((g.subject_type = 'user' AND g.subject_id = $1) OR (g.subject_type = 'group' AND g.subject_id = ANY($2::uuid[])))
              AND (g.expires_at IS NULL OR g.expires_at > now())), 0))`;

/** SQL fragment: the best rank granted directly on item `s`. */
export const ITEM_GRANT = `CASE WHEN $2::uuid[] @> ARRAY['00000000-0000-4000-8000-00000000c0a0']::uuid[] THEN 4 ELSE COALESCE((SELECT max(g.rank) FROM content.grants g
            WHERE g.object_type = 'item' AND g.object_id = s.id
              AND ((g.subject_type = 'user' AND g.subject_id = $1) OR (g.subject_type = 'group' AND g.subject_id = ANY($2::uuid[])))
              AND (g.expires_at IS NULL OR g.expires_at > now())), 0) END`;

export interface ArchiveAccess {
  rel: number;
  /** Enough to see the archive's title and card when some item inside was lent to the user. */
  metaRel: number;
  row: Record<string, any>;
}

/** Load an archive and the caller's access. Unknown, deleted and inaccessible archives all answer 404. */
export async function loadArchive(pool: Pool, actor: Actor, id: string, opts: { deleted?: boolean } = {}): Promise<ArchiveAccess> {
  const { rows } = await pool.query(
    `SELECT m.*, ${ARCHIVE_REL} AS rel,
            EXISTS (SELECT 1 FROM content.sub_items s WHERE s.master_item_id = m.id AND s.deleted_at IS NULL AND ${ITEM_GRANT} >= 1) AS item_lent
       FROM content.master_items m
      WHERE m.id = $3 AND ${opts.deleted ? "m.deleted_at IS NOT NULL" : "m.deleted_at IS NULL"}`,
    [actor.userId, actor.groups, id],
  );
  const row = rows[0];
  if (!row) throw new HttpError(404, "not_found");
  const rel = Number(row.rel);
  const metaRel = Math.max(rel, row.item_lent ? 2 : 0);
  if (metaRel < 1) throw new HttpError(404, "not_found");
  return { rel, metaRel, row };
}

export interface ItemAccess {
  rel: number;
  row: Record<string, any>;
  archive: Record<string, any>;
}

/** Load an item and the caller's effective access: the best of archive-level and item-level grants. Drafts need edit rights. */
export async function loadItem(pool: Pool, actor: Actor, id: string, opts: { deleted?: boolean } = {}): Promise<ItemAccess> {
  const { rows } = await pool.query(
    `SELECT s.*, m.owner_id AS archive_owner, m.title AS archive_title, m.visibility,
            GREATEST(${ARCHIVE_REL}, ${ITEM_GRANT}) AS rel
       FROM content.sub_items s
       JOIN content.master_items m ON m.id = s.master_item_id AND m.deleted_at IS NULL
      WHERE s.id = $3 AND ${opts.deleted ? "s.deleted_at IS NOT NULL" : "s.deleted_at IS NULL"}`,
    [actor.userId, actor.groups, id],
  );
  const row = rows[0];
  if (!row) throw new HttpError(404, "not_found");
  let rel = Number(row.rel);
  if (rel < 1) throw new HttpError(404, "not_found");
  if (row.status === "draft" && rel < RANK.editor) throw new HttpError(404, "not_found");
  // An `attempt` grant only opens quizzes.
  if (rel === RANK.attempt && row.kind !== "quiz") throw new HttpError(404, "not_found");
  return { rel, row, archive: { id: row.master_item_id, ownerId: row.archive_owner, title: row.archive_title } };
}

export function need(rel: number, min: number): void {
  if (rel < min) throw new HttpError(403, "forbidden");
}
