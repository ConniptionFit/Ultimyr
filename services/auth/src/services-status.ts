export interface ServiceStatus {
  name: string;
  ok: boolean;
  /** Round trip in milliseconds. */
  ms: number;
  /** Why it is not ok, in words an admin can act on. */
  problem?: string;
}

/** Ask each service's /readyz, in parallel, with a short timeout. Never throws. */
export async function checkServices(
  services: { name: string; url: string }[],
  timeoutMs = 2000,
  doFetch: typeof fetch = fetch,
): Promise<ServiceStatus[]> {
  return Promise.all(
    services.map(async ({ name, url }): Promise<ServiceStatus> => {
      const start = Date.now();
      try {
        const res = await doFetch(`${url}/readyz`, { signal: AbortSignal.timeout(timeoutMs) });
        const ms = Date.now() - start;
        return res.ok ? { name, ok: true, ms } : { name, ok: false, ms, problem: `answered ${res.status}, so it is running but not ready (check its database and logs)` };
      } catch (e) {
        const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
        return { name, ok: false, ms: Date.now() - start, problem: timedOut ? `no answer within ${timeoutMs / 1000} seconds` : "could not connect (is the container running?)" };
      }
    }),
  );
}
