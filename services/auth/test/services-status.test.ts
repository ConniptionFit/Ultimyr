import { describe, expect, it } from "vitest";
import { checkServices } from "../src/services-status.js";

const reply = (status: number) => (async () => new Response("{}", { status })) as unknown as typeof fetch;

describe("checkServices", () => {
  it("reports a ready service", async () => {
    const [s] = await checkServices([{ name: "Content", url: "http://content:4002" }], 500, reply(200));
    expect(s).toMatchObject({ name: "Content", ok: true });
  });
  it("explains a service that is up but not ready", async () => {
    const [s] = await checkServices([{ name: "Quizzes", url: "http://quiz:4003" }], 500, reply(503));
    expect(s!.ok).toBe(false);
    expect(s!.problem).toContain("503");
  });
  it("explains one that cannot be reached", async () => {
    const down = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    const [s] = await checkServices([{ name: "MCP", url: "http://mcp:4005" }], 500, down);
    expect(s).toMatchObject({ ok: false });
    expect(s!.problem).toContain("could not connect");
  });
  it("gives up after the timeout", async () => {
    const hang = ((_u: string, init: RequestInit) => new Promise((_r, rej) => init.signal!.addEventListener("abort", () => rej(init.signal!.reason)))) as unknown as typeof fetch;
    const [s] = await checkServices([{ name: "Notes", url: "http://notes:4006" }], 50, hang);
    expect(s!.problem).toContain("no answer");
  });
  it("checks every service and asks /readyz", async () => {
    const seen: string[] = [];
    const spy = (async (u: string) => {
      seen.push(u);
      return new Response("{}");
    }) as unknown as typeof fetch;
    const r = await checkServices(
      [
        { name: "A", url: "http://a" },
        { name: "B", url: "http://b" },
      ],
      500,
      spy,
    );
    expect(r.map((x) => x.name)).toEqual(["A", "B"]);
    expect(seen).toEqual(["http://a/readyz", "http://b/readyz"]);
  });
});
