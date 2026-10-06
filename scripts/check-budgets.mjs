#!/usr/bin/env node
// Fails if the web build grows past its performance budget. Run after `pnpm build`.
// Sizes are gzip, which is what browsers download. Raise a limit only on purpose, and say why in the pull request.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const next = join(import.meta.dirname, "../apps/web/.next");
const dir = join(next, "static/chunks");
const BUDGET = {
  totalJsKb: 450, // every client chunk together (without the legacy-browser polyfills), an upper bound for any single page
  pageJsKb: 230, // the heaviest page's first load: the JavaScript a browser downloads to open it
  largestJsKb: 90, // the biggest single chunk (the React runtime)
  cssKb: 15,
};

function walk(d) {
  return readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

let files;
try {
  files = walk(dir);
} catch {
  console.error(`No build found at ${dir}. Run "pnpm build" first.`);
  process.exit(2);
}
const gz = (f) => gzipSync(readFileSync(f)).length / 1024;
// Next ships one nomodule polyfill chunk. Browsers that run modules (everything current) never download it, so it is reported but not counted.
const manifestPath = join(next, "build-manifest.json");
const polyfills = new Set(
  existsSync(manifestPath) ? (JSON.parse(readFileSync(manifestPath, "utf8")).polyfillFiles ?? []).map((p) => join(next, p)) : [],
);
const all = files.filter((f) => f.endsWith(".js")).map((f) => ({ f, kb: gz(f) }));
const js = all.filter((x) => !polyfills.has(x.f));
const legacyKb = all.filter((x) => polyfills.has(x.f)).reduce((a, x) => a + x.kb, 0);

// First load per page, from Next's own route stats: what a visitor really downloads for the heaviest page.
let heaviest = { kb: 0, route: "" };
const statsPath = join(next, "diagnostics/route-bundle-stats.json");
if (existsSync(statsPath)) {
  for (const r of JSON.parse(readFileSync(statsPath, "utf8"))) {
    const kb = r.firstLoadChunkPaths
      .filter((p) => p.endsWith(".js"))
      .reduce((a, p) => a + gz(join(import.meta.dirname, "../apps/web", p)), 0);
    if (kb > heaviest.kb) heaviest = { kb, route: r.route };
  }
}
const css = files.filter((f) => f.endsWith(".css")).map(gz);
const sum = (a) => a.reduce((x, y) => x + y, 0);
const largest = js.reduce((m, x) => (x.kb > m.kb ? x : m), { kb: 0, f: "" });

const rows = [
  ["total JavaScript", sum(js.map((x) => x.kb)), BUDGET.totalJsKb],
  ...(heaviest.route ? [[`heaviest page first load (${heaviest.route})`, heaviest.kb, BUDGET.pageJsKb]] : []),
  [`largest chunk (${largest.f.split("/").pop()})`, largest.kb, BUDGET.largestJsKb],
  ["CSS", sum(css), BUDGET.cssKb],
];
let failed = false;
for (const [name, used, max] of rows) {
  const ok = used <= max;
  failed ||= !ok;
  console.log(`${ok ? "ok  " : "OVER"} ${name}: ${used.toFixed(1)} KB gzip (budget ${max} KB)`);
}
if (legacyKb) console.log(`note ${legacyKb.toFixed(1)} KB gzip of legacy-browser polyfills is not counted (modern browsers never load it)`);
process.exit(failed ? 1 : 0);
