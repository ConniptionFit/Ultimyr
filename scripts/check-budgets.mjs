#!/usr/bin/env node
// Fails if the web build grows past its performance budget. Run after `pnpm build`.
// Sizes are gzip, which is what browsers download. Raise a limit only on purpose, and say why in the pull request.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const dir = join(import.meta.dirname, "../apps/web/.next/static/chunks");
const BUDGET = {
  totalJsKb: 500, // every client chunk together, an upper bound for any single page
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
const js = files.filter((f) => f.endsWith(".js")).map((f) => ({ f, kb: gz(f) }));
const css = files.filter((f) => f.endsWith(".css")).map(gz);
const sum = (a) => a.reduce((x, y) => x + y, 0);
const largest = js.reduce((m, x) => (x.kb > m.kb ? x : m), { kb: 0, f: "" });

const rows = [
  ["total JavaScript", sum(js.map((x) => x.kb)), BUDGET.totalJsKb],
  [`largest chunk (${largest.f.split("/").pop()})`, largest.kb, BUDGET.largestJsKb],
  ["CSS", sum(css), BUDGET.cssKb],
];
let failed = false;
for (const [name, used, max] of rows) {
  const ok = used <= max;
  failed ||= !ok;
  console.log(`${ok ? "ok  " : "OVER"} ${name}: ${used.toFixed(1)} KB gzip (budget ${max} KB)`);
}
process.exit(failed ? 1 : 0);
