import { defineConfig } from "tsup";
export default defineConfig({
  entry: { "migrate-cli": "src/migrate-cli.ts" },
  format: ["esm"],
  target: "node22",
  outDir: "dist",
  noExternal: [/^@ultimyr\//],
});
