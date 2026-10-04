import { defineConfig } from "vitest/config";
export default defineConfig({ test: { coverage: { provider: "v8", include: ["src/**"], thresholds: { statements: 95, branches: 85, functions: 100, lines: 95 } } } });
