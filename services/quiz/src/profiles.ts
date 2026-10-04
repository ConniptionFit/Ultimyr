import { createHash } from "node:crypto";
import { canonicalJson, officialProfiles, parseProfile, type ScoringProfile } from "@ultimyr/scoring";
import { HttpError, uuidv7, type Pool } from "@ultimyr/service-kit";
import { z } from "zod";

export const DEFAULT_PROFILE_NAME = "Simple percent (70% to pass)";

export const checksum = (p: ScoringProfile) => createHash("sha256").update(canonicalJson(p)).digest("hex");

/** Make sure the profiles that ship with Ultimyr exist. Existing rows are never changed: a changed profile needs a new version. */
export async function ensureOfficialProfiles(pool: Pool): Promise<void> {
  for (const p of officialProfiles()) {
    await pool.query(
      "INSERT INTO quiz.scoring_profiles (id, owner_id, name, version, definition, checksum, is_official) VALUES ($1, NULL, $2, 1, $3, $4, true) ON CONFLICT (name, version) WHERE is_official DO NOTHING",
      [uuidv7(), p.name, JSON.stringify(p), checksum(p)],
    );
  }
}

export function profileRow(r: Record<string, any>) {
  return {
    id: r.id,
    name: r.name,
    version: r.version,
    official: r.is_official,
    ownerId: r.owner_id,
    fidelity: r.definition.fidelity,
    source: r.definition.source ?? null,
    verifiedOn: r.definition.verifiedOn ?? null,
    definition: r.definition,
    checksum: r.checksum,
    createdAt: r.created_at,
  };
}

export const loadProfileDef = (row: { definition: unknown }) => parseProfile(row.definition);

/** Parse a profile definition, turning schema problems into a readable 400. */
export function profileOr400(def: unknown): ScoringProfile {
  try {
    return parseProfile(def);
  } catch (e) {
    if (e instanceof z.ZodError) throw new HttpError(400, "invalid_request", { issues: e.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)) });
    throw e;
  }
}
