import { describe, expect, it } from "vitest";
import { withCurrent } from "./study-settings";

describe("withCurrent", () => {
  const presets: Array<[number, string]> = [[10, "10"], [20, "20"]];
  it("keeps the presets when the saved value is one of them", () => {
    expect(withCurrent(presets, 20, String)).toBe(presets);
  });
  it("adds an odd saved value in order so the choice still shows as selected", () => {
    expect(withCurrent(presets, 15, String)).toEqual([[10, "10"], [15, "15"], [20, "20"]]);
  });
});
