import { describe, expect, it } from "vitest";
import { changelogSection, compareVersions, createAbout } from "../src/about.js";

const CHANGELOG = `# Changelog

## Unreleased
- **New:** the About page.

## 1.1.0 (2026-11-01)
- Shiny.

## 1.0.0 (2026-10-04)
- First.
`;

const COMMIT = "a".repeat(40);
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => String(body) });
const no = (status: number) => ({ ok: false, status, json: async () => ({}), text: async () => "" });

function fake(routes: { release?: unknown | number; compare?: unknown | number; changelog?: string }) {
  const calls: string[] = [];
  const f = async (url: string) => {
    calls.push(url);
    const pick = url.includes("/releases/latest") ? routes.release : url.includes("/compare/") ? routes.compare : routes.changelog;
    if (pick === undefined || typeof pick === "number") return no(typeof pick === "number" ? pick : 404);
    return ok(pick);
  };
  return { f, calls };
}

const build = { version: "1.0.0", commit: COMMIT, builtAt: null };

describe("about helpers", () => {
  it("compares versions", () => {
    expect(compareVersions("v1.10.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareVersions("1.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.0.0", "1.0.1")).toBeLessThan(0);
  });
  it("cuts a changelog section", () => {
    expect(changelogSection(CHANGELOG, "unreleased")?.body).toBe("- **New:** the About page.");
    expect(changelogSection(CHANGELOG, "1.1.0")).toEqual({ title: "1.1.0 (2026-11-01)", body: "- Shiny." });
    expect(changelogSection(CHANGELOG, "9.9.9")).toBeNull();
  });
});

describe("about", () => {
  it("reports a newer release and its changelog", async () => {
    const { f } = fake({ release: { tag_name: "v1.1.0", html_url: "https://example/r" }, compare: { ahead_by: 3 }, changelog: CHANGELOG });
    const a = await createAbout({ repo: "o/r", enabled: true, build, fetch: f })();
    expect(a.update).toMatchObject({ status: "behind", newRelease: true, latest: { version: "1.1.0" }, commitsBehind: 3 });
    expect(a.changelog?.title).toBe("1.1.0 (2026-11-01)");
    expect(a.build.commitUrl).toBe(`https://github.com/o/r/commit/${COMMIT}`);
  });

  it("is behind by commits when there is no release, and shows Unreleased", async () => {
    const { f } = fake({ release: 404, compare: { ahead_by: 2 }, changelog: CHANGELOG });
    const a = await createAbout({ repo: "o/r", enabled: true, build, fetch: f })();
    expect(a.update).toMatchObject({ status: "behind", latest: null, commitsBehind: 2 });
    expect(a.changelog?.title).toBe("Unreleased");
  });

  it("is current when nothing is newer", async () => {
    const { f } = fake({ release: { tag_name: "v1.0.0" }, compare: { ahead_by: 0 }, changelog: CHANGELOG });
    const a = await createAbout({ repo: "o/r", enabled: true, build, fetch: f })();
    expect(a.update).toMatchObject({ status: "current", commitsBehind: 0 });
    expect(a.changelog?.title).toBe("1.0.0 (2026-10-04)");
  });

  it("fails quietly when offline, and retries after the short failure window", async () => {
    let t = 0;
    let calls = 0;
    const f = async () => {
      calls++;
      throw new Error("offline");
    };
    const about = createAbout({ repo: "o/r", enabled: true, build, fetch: f, now: () => t });
    expect((await about()).update).toMatchObject({ status: "unknown", reason: "Could not reach GitHub." });
    const first = calls;
    await about();
    expect(calls).toBe(first); // cached
    t = 11 * 60 * 1000;
    await about();
    expect(calls).toBeGreaterThan(first);
  });

  it("does not call GitHub when switched off", async () => {
    const { f, calls } = fake({});
    const a = await createAbout({ repo: "o/r", enabled: false, build, fetch: f })();
    expect(a.update.status).toBe("disabled");
    expect(calls).toHaveLength(0);
  });
});
