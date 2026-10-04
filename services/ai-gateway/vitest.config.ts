import { defineConfig } from "vitest/config";

// Integration tests share one Postgres database and reset its schema, so files must run one at a time.
export default defineConfig({ test: { fileParallelism: false } });
