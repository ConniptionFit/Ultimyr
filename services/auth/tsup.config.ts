import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "tsup";

/** Version from the root package.json, and the commit from the checkout (read from .git files, since the image has no git binary). */
function buildInfo() {
  const root = resolve(import.meta.dirname, "../..");
  const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8").trim() : "");
  const version = (JSON.parse(read(resolve(root, "package.json")) || "{}") as { version?: string }).version ?? "0.0.0";
  let commit = process.env.ULTIMYR_COMMIT ?? "";
  if (!commit) {
    const head = read(resolve(root, ".git/HEAD"));
    const ref = /^ref: (.+)$/.exec(head)?.[1];
    if (!ref) commit = head;
    else {
      commit = read(resolve(root, ".git", ref));
      if (!commit) commit = new RegExp(`^([0-9a-f]{40}) ${ref}$`, "m").exec(read(resolve(root, ".git/packed-refs")))?.[1] ?? "";
    }
  }
  return { version, commit: /^[0-9a-f]{40}$/.test(commit) ? commit : "", builtAt: new Date().toISOString() };
}

export default defineConfig({
  entry: { main: "src/main.ts" },
  format: ["esm"],
  target: "node22",
  outDir: "dist",
  noExternal: [/^@ultimyr\//],
  define: { __BUILD_INFO__: JSON.stringify(buildInfo()) },
});
