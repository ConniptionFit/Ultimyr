import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Supervisor } from "../src/supervisor.js";

const dir = mkdtempSync(join(tmpdir(), "ultimyr-sup-"));
const script = (name: string, body: string) => {
  const p = join(dir, name);
  writeFileSync(p, body);
  return p;
};
const server = (port: number) =>
  `require("http").createServer((q,r)=>r.end("ok")).listen(${port},"127.0.0.1");process.on("SIGTERM",()=>process.exit(0));`;

let sup: Supervisor | undefined;
afterEach(async () => {
  await sup?.stop();
  sup = undefined;
});

describe("Supervisor", () => {
  it("restarts a service that exits without touching the others", async () => {
    const stable = script("stable.cjs", server(47101));
    const flaky = script("flaky.cjs", `setTimeout(()=>process.exit(1),100);`);
    sup = new Supervisor(
      [
        { name: "stable", entry: stable, port: 47101, group: 0, env: process.env },
        { name: "flaky", entry: flaky, port: 47102, group: 0, env: process.env },
      ],
      { backoffMs: 50, groupWaitMs: 500, log: () => {} },
    );
    await sup.start();
    await new Promise((r) => setTimeout(r, 900));
    const status = await sup.status();
    expect(status.find((s) => s.name === "flaky")!.restarts).toBeGreaterThanOrEqual(2);
    const stableStatus = status.find((s) => s.name === "stable")!;
    expect(stableStatus.state).toBe("up");
    expect(stableStatus.restarts).toBe(0);
  });

  it("stops every service on stop()", async () => {
    const stable = script("stable2.cjs", server(47103));
    sup = new Supervisor([{ name: "stable", entry: stable, port: 47103, group: 0, env: process.env }], { groupWaitMs: 2000, log: () => {} });
    await sup.start();
    const [before] = await sup.status();
    expect(before!.state).toBe("up");
    await sup.stop();
    const [after] = await sup.status();
    expect(after!.state).toBe("down");
  });
});
