// Tiny load check, no dependencies. Usage: node scripts/loadtest.mjs [baseUrl] [seconds] [concurrency]
// Hits the public health and static endpoints, so it is safe to run against a live install.
const base = process.argv[2] ?? "http://localhost:3000";
const seconds = Number(process.argv[3] ?? 10);
const workers = Number(process.argv[4] ?? 20);
const paths = ["/", "/login", "/manifest.webmanifest", "/.well-known/jwks.json", "/.well-known/oauth-authorization-server"];
const times = [];
let errors = 0;
const end = Date.now() + seconds * 1000;
async function worker(n) {
  for (let i = n; Date.now() < end; i++) {
    const t = performance.now();
    try {
      const r = await fetch(base + paths[i % paths.length]);
      await r.arrayBuffer();
      if (r.status >= 500) errors++;
      times.push(performance.now() - t);
    } catch {
      errors++;
    }
  }
}
await Promise.all(Array.from({ length: workers }, (_, i) => worker(i)));
times.sort((a, b) => a - b);
const q = (p) => times[Math.min(times.length - 1, Math.floor(times.length * p))]?.toFixed(1);
console.log(`${times.length} requests in ${seconds}s (${(times.length / seconds).toFixed(0)}/s), ${errors} errors`);
console.log(`p50 ${q(0.5)} ms, p95 ${q(0.95)} ms, p99 ${q(0.99)} ms`);
process.exit(errors ? 1 : 0);
