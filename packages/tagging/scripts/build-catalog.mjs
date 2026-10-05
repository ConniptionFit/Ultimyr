#!/usr/bin/env node
// Regenerates data/catalog.json (names and Lucide's own search tags) and data/nodes.json (the SVG shapes) from the
// pinned `lucide-static` devDependency. Run `pnpm --filter @ultimyr/tagging build:catalog` after bumping that version,
// then commit the result. Lucide is ISC licensed; its notice is kept in data/LUCIDE-LICENSE.
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const pkgDir = dirname(require.resolve("lucide-static/package.json"));
const read = (f) => JSON.parse(readFileSync(join(pkgDir, f), "utf8"));
const version = read("package.json").version;
const tags = read("tags.json");
const nodes = read("icon-nodes.json");

const names = Object.keys(nodes).sort();
const catalog = { lucideVersion: version, count: names.length, icons: Object.fromEntries(names.map((n) => [n, [...new Set((tags[n] ?? []).map((t) => String(t).toLowerCase().trim()).filter(Boolean))]])) };
const out = join(import.meta.dirname, "../data");
writeFileSync(join(out, "catalog.json"), JSON.stringify(catalog) + "\n");
writeFileSync(join(out, "nodes.json"), JSON.stringify(Object.fromEntries(names.map((n) => [n, nodes[n]]))) + "\n");
copyFileSync(join(pkgDir, "LICENSE"), join(out, "LUCIDE-LICENSE"));
console.log(`Lucide ${version}: ${names.length} icons written to data/`);
