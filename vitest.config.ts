import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 10000,
    maxWorkers: 1,
    // Upstream suites exercise the full catalog; tests/da-product.test.ts covers the facade default.
    env: { PR_MCP_FACADE: "0" },
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // src/index.ts is the CLI entry: tests/index.test.ts runs it as a subprocess, which coverage
      // cannot see (it counted as 0 % of 165 branches).
      exclude: ["src/**/*.d.ts", "src/resources/**/*.json", "src/index.ts"],
      reporter: ["text", "html", "lcov", "json-summary"],
      reportsDirectory: "coverage",
      thresholds: {
        statements: 91,
        branches: 90,
        functions: 94,
        // Windows-only platform branches produce a slightly lower line result in CI.
        lines: 93,
      },
    },
  },
});
