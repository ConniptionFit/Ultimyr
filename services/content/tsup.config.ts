import { defineConfig } from "tsup";
export default defineConfig({
  entry: { main: "src/main.ts" },
  format: ["esm"],
  target: "node22",
  outDir: "dist",
  // Some bundled CommonJS packages (for example @fastify/rate-limit) call require() on Node built-ins, which an ES module bundle does not provide.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  noExternal: [/^@ultimyr\//],
});
