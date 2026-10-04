import { z } from "zod";

const mode = <const T extends readonly [string, ...string[]]>(values: T, d: T[number]) => z.enum(values).default(d);

export const profileSchema = z
  .object({
    schema: z.literal(1).default(1),
    name: z.string().min(1).max(100),
    /** How closely this models a real exam: be honest. */
    fidelity: z.enum(["published_formula", "community_estimate", "custom"]).default("custom"),
    source: z.string().max(500).optional(),
    verifiedOn: z.iso.date().optional(),
    rounding: mode(["half_up", "floor", "half_even"], "half_up"),
    types: z
      .object({
        multi: mode(["all_or_nothing", "partial", "penalty"], "all_or_nothing"),
        fib: mode(["all_or_nothing", "per_blank"], "per_blank"),
        dnd: mode(["all_or_nothing", "per_item"], "per_item"),
        pbq: mode(["all_or_nothing", "weighted"], "weighted"),
      })
      .default({ multi: "all_or_nothing", fib: "per_blank", dnd: "per_item", pbq: "weighted" }),
    /** Share of a question's marks lost for a wrong (not blank) single choice, in basis points. */
    negativeMarkingBp: z.number().int().min(0).max(10_000).default(0),
    floorAtZero: z.boolean().default(true),
    excludePretest: z.boolean().default(true),
    scale: z
      .object({
        min: z.number().int(),
        max: z.number().int(),
        /** Piecewise-linear map from raw score (basis points of marks) to the scaled score. */
        points: z.array(z.object({ rawBp: z.number().int().min(0).max(10_000), scaled: z.number().int() })).min(2).max(50),
      })
      .optional(),
    pass: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("percent"), minBp: z.number().int().min(0).max(10_000) }),
      z.object({ kind: z.literal("scaled"), min: z.number().int() }),
    ]),
    /** Every domain with scored questions must reach this raw percentage too. */
    domainMinBp: z.number().int().min(0).max(10_000).optional(),
  })
  .superRefine((p, ctx) => {
    const bad = (message: string) => ctx.addIssue({ code: "custom", message });
    if (p.pass.kind === "scaled" && !p.scale) bad("a scaled pass mark needs a scale");
    if (p.scale) {
      const pts = p.scale.points;
      if (pts[0]!.rawBp !== 0 || pts[pts.length - 1]!.rawBp !== 10_000) bad("scale must start at 0 and end at 10000 basis points");
      for (let i = 1; i < pts.length; i++) {
        if (pts[i]!.rawBp <= pts[i - 1]!.rawBp) bad("scale points must be strictly increasing in rawBp");
        if (pts[i]!.scaled < pts[i - 1]!.scaled) bad("scaled scores must never decrease");
      }
      if (p.scale.min > p.scale.max) bad("scale min exceeds max");
      for (const pt of pts) if (pt.scaled < p.scale.min || pt.scaled > p.scale.max) bad("scale points must lie within min and max");
    }
  });

export type ScoringProfile = z.infer<typeof profileSchema>;
export type ProfileInput = z.input<typeof profileSchema>;

export function parseProfile(input: unknown): ScoringProfile {
  return profileSchema.parse(input);
}

/** Stable JSON: object keys sorted, so equal profiles always serialise (and hash) identically. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}
