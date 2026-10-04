import { parseProfile, type ProfileInput } from "./profile.js";

/**
 * Profiles that ship with Ultimyr. Fidelity is stated honestly: vendors rarely publish their
 * raw-to-scaled conversion, so anything not taken from a published formula is a community estimate.
 */
export const OFFICIAL_PROFILES: ProfileInput[] = [
  {
    name: "Simple percent (70% to pass)",
    fidelity: "custom",
    source: "Ultimyr default: percent of marks earned, no scaling.",
    verifiedOn: "2026-10-04",
    pass: { kind: "percent", minBp: 7000 },
  },
  {
    name: "Strict percent (all-or-nothing, 80% to pass)",
    fidelity: "custom",
    source: "Ultimyr: multi-select, fill-in, drag-and-drop and lab questions earn nothing unless fully right.",
    verifiedOn: "2026-10-04",
    types: { multi: "all_or_nothing", fib: "all_or_nothing", dnd: "all_or_nothing", pbq: "all_or_nothing" },
    pass: { kind: "percent", minBp: 8000 },
  },
  {
    name: "Scaled 100 to 900 (pass at 700)",
    fidelity: "community_estimate",
    source:
      "Many IT certifications report a 100 to 900 scale. The vendor conversion is unpublished, so this maps raw percent linearly. Treat the scaled number as an estimate.",
    verifiedOn: "2026-10-04",
    scale: {
      min: 100,
      max: 900,
      points: [
        { rawBp: 0, scaled: 100 },
        { rawBp: 10_000, scaled: 900 },
      ],
    },
    pass: { kind: "scaled", min: 700 },
  },
];

export const officialProfiles = () => OFFICIAL_PROFILES.map((p) => parseProfile(p));
