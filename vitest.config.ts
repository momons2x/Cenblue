import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: false,
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reportsDirectory: "coverage",
      reporter: ["text", "lcov"],
      include: ["packages/*/src/**/*.ts", "workers/**/*.ts", "apps/dashboard/app/lib/**/*.ts"],
      exclude: ["**/*.test.ts", "**/*.smoke.ts", "**/node_modules/**"],
      thresholds: {
        lines: 40,
        statements: 37,
        branches: 33,
        functions: 40,
      },
    },
  },
});
