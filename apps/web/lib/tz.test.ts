import { describe, expect, it } from "vitest";
import { withZone } from "./tz";

describe("withZone", () => {
  it("adds the zone to reads that count days", () => {
    expect(withZone("study/queue", "America/Chicago")).toBe("study/queue?tz=America%2FChicago");
    expect(withZone("study/stats?archive=x", "Europe/Paris")).toBe("study/stats?archive=x&tz=Europe%2FParis");
    expect(withZone("analytics?days=30", "UTC")).toBe("analytics?days=30&tz=UTC");
    expect(withZone("study/activity?days=84", "Asia/Tokyo")).toBe("study/activity?days=84&tz=Asia%2FTokyo");
  });
  it("leaves other paths, an existing zone and a missing zone alone", () => {
    expect(withZone("archives", "UTC")).toBe("archives");
    expect(withZone("study/review", "UTC")).toBe("study/review");
    expect(withZone("study/settings", "UTC")).toBe("study/settings");
    expect(withZone("study/stats?tz=UTC", "Asia/Tokyo")).toBe("study/stats?tz=UTC");
    expect(withZone("study/queue", null)).toBe("study/queue");
  });
});
