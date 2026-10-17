import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";

export interface Child {
  name: string;
  /** Script to run with node. */
  entry: string;
  port: number;
  group: number;
  env: NodeJS.ProcessEnv;
}

export interface ChildStatus {
  name: string;
  state: "starting" | "up" | "down" | "backoff";
  restarts: number;
  pid?: number;
}

export interface SupervisorOptions {
  log?: (msg: string) => void;
  /** First restart delay; doubles up to maxBackoffMs. */
  backoffMs?: number;
  maxBackoffMs?: number;
  /** A child that stays up this long gets its backoff reset. */
  stableMs?: number;
  /** How long a start group may take to answer /healthz before the next group starts anyway. */
  groupWaitMs?: number;
  /** How long a child gets after SIGTERM before SIGKILL. */
  killAfterMs?: number;
}

async function healthy(port: number): Promise<boolean> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * Runs each service as its own Node process and restarts it when it exits, so one service crashing never takes another
 * down. Output is prefixed with the service name. Stops them all on SIGTERM.
 */
export class Supervisor {
  private readonly procs = new Map<string, { child: Child; proc?: ChildProcess; state: ChildStatus["state"]; restarts: number; backoff: number; timer?: NodeJS.Timeout }>();
  private stopping = false;
  private readonly log: (msg: string) => void;
  private readonly opts: Required<Omit<SupervisorOptions, "log">>;

  constructor(
    private readonly children: Child[],
    options: SupervisorOptions = {},
  ) {
    this.log = options.log ?? ((m) => console.log(m));
    this.opts = {
      backoffMs: options.backoffMs ?? 1000,
      maxBackoffMs: options.maxBackoffMs ?? 30_000,
      stableMs: options.stableMs ?? 60_000,
      groupWaitMs: options.groupWaitMs ?? 60_000,
      killAfterMs: options.killAfterMs ?? 10_000,
    };
    for (const c of children) this.procs.set(c.name, { child: c, state: "down", restarts: 0, backoff: this.opts.backoffMs });
  }

  /** Starts every group in order, waiting for each to answer /healthz (or the wait to run out) before the next. */
  async start(): Promise<void> {
    const groups = [...new Set(this.children.map((c) => c.group))].sort((a, b) => a - b);
    for (const g of groups) {
      const members = this.children.filter((c) => c.group === g);
      for (const c of members) this.spawn(c.name);
      const deadline = Date.now() + this.opts.groupWaitMs;
      while (!this.stopping && Date.now() < deadline) {
        const ups = await Promise.all(members.map((c) => healthy(c.port)));
        if (ups.every(Boolean)) break;
        await new Promise((r) => setTimeout(r, 300));
      }
    }
  }

  private spawn(name: string): void {
    const entry = this.procs.get(name)!;
    if (this.stopping) return;
    const { child } = entry;
    entry.state = "starting";
    const proc = spawn(process.execPath, [child.entry], { env: child.env, stdio: ["ignore", "pipe", "pipe"] });
    entry.proc = proc;
    const startedAt = Date.now();
    const pipe = (stream: NodeJS.ReadableStream | null, out: (m: string) => void) => {
      let buf = "";
      stream?.on("data", (d: Buffer) => {
        buf += d.toString();
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i).trimEnd();
          buf = buf.slice(i + 1);
          if (line) out(`[${name}] ${line}`);
        }
      });
      stream?.on("end", () => buf.trim() && out(`[${name}] ${buf.trim()}`));
    };
    pipe(proc.stdout, (m) => console.log(m));
    pipe(proc.stderr, (m) => console.error(m));
    proc.on("error", (e) => this.log(`[supervisor] ${name} could not start: ${e.message}`));
    proc.on("exit", (code, signal) => {
      entry.proc = undefined;
      if (this.stopping) {
        entry.state = "down";
        return;
      }
      if (Date.now() - startedAt >= this.opts.stableMs) entry.backoff = this.opts.backoffMs;
      entry.state = "backoff";
      entry.restarts++;
      this.log(`[supervisor] ${name} exited (${signal ?? code}); restarting in ${Math.round(entry.backoff)} ms`);
      entry.timer = setTimeout(() => this.spawn(name), entry.backoff);
      entry.backoff = Math.min(entry.backoff * 2, this.opts.maxBackoffMs);
    });
  }

  /** Current state of each service. A service counts as up once it answers /healthz. */
  async status(): Promise<ChildStatus[]> {
    return Promise.all(
      [...this.procs.values()].map(async (e) => {
        const up = e.proc ? await healthy(e.child.port) : false;
        if (up) e.state = "up";
        else if (e.state === "up") e.state = e.proc ? "starting" : "backoff";
        return { name: e.child.name, state: e.state, restarts: e.restarts, pid: e.proc?.pid };
      }),
    );
  }

  /** SIGTERM to every service, SIGKILL for any that has not exited after killAfterMs. */
  async stop(): Promise<void> {
    this.stopping = true;
    const waits: Promise<void>[] = [];
    for (const e of this.procs.values()) {
      if (e.timer) clearTimeout(e.timer);
      const proc = e.proc;
      if (!proc) continue;
      waits.push(
        new Promise((resolve) => {
          const kill = setTimeout(() => proc.kill("SIGKILL"), this.opts.killAfterMs);
          proc.once("exit", () => {
            clearTimeout(kill);
            resolve();
          });
          proc.kill("SIGTERM");
        }),
      );
    }
    await Promise.all(waits);
  }
}

/**
 * Container health endpoint. 200 when every service is up, 503 otherwise, with each service's state in the body.
 * Docker's health check calls it, and the web container waits for it.
 */
export function healthServer(sup: Supervisor, port: number, host = "0.0.0.0"): Promise<Server> {
  // Answers from a short-lived snapshot so frequent health checks do not make every service log six requests each time.
  let cached: { at: number; services: ChildStatus[] } | undefined;
  const server = createServer(async (req, res) => {
    if (req.url !== "/healthz" && req.url !== "/readyz") {
      res.writeHead(404).end();
      return;
    }
    if (!cached || Date.now() - cached.at > 5000) cached = { at: Date.now(), services: await sup.status() };
    const { services } = cached;
    const ok = services.every((s) => s.state === "up");
    res.writeHead(ok ? 200 : 503, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: ok ? "ok" : "degraded", services }));
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve(server));
  });
}
