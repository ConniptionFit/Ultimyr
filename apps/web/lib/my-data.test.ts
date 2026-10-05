import { describe, expect, it } from "vitest";
import { collectMyData } from "./my-data";

const archives = [
  { id: "1", slug: "a", title: "A" },
  { id: "2", slug: "a", title: "A again" },
];

function fake(fail: string[] = []) {
  return async <T,>(_m: string, path: string): Promise<T> => {
    if (fail.includes(path)) throw new Error("nope");
    if (path.startsWith("archives?")) return { archives } as T;
    return { path } as T;
  };
}

describe("collectMyData", () => {
  it("collects every part and keeps duplicate slugs apart", async () => {
    const r = await collectMyData(fake(), { name: "J" }, new Date("2026-10-05T00:00:00Z"));
    expect(r.skipped).toEqual([]);
    const names = r.files.map((f) => f.path);
    expect(names).toContain("archives/a.ultimyr.json");
    expect(names).toContain("archives/a-2.ultimyr.json");
    expect(names).toContain("notes/a.json");
    expect(names).toContain("credentials.json");
    expect(names).toContain("attempts.json");
    expect(r.files.find((f) => f.path === "README.txt")!.text).toContain("Everything was read.");
  });
  it("reports parts that cannot be read and carries on", async () => {
    const r = await collectMyData(fake(["credentials", "archives/2/export"]), {});
    expect(r.skipped).toEqual(["credentials", "archive A again"]);
    expect(r.files.map((f) => f.path)).not.toContain("credentials.json");
    expect(r.files.find((f) => f.path === "README.txt")!.text).toContain("Could not read: credentials, archive A again.");
  });
  it("notes a failed archive list", async () => {
    const r = await collectMyData(fake(["archives?scope=mine"]), {});
    expect(r.skipped).toContain("archives");
  });
});
