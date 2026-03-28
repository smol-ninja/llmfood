import { defineConfig } from "vitest/config";

const CI = Boolean(process.env.CI);

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.ts"],
    outputFile: CI ? "./test-results.json" : undefined,
    reporters: CI ? ["github-actions", "json"] : ["default"],
    coverage: {
      exclude: ["src/index.ts", "src/turndown-plugin-gfm.d.ts", "src/types.ts"],
      include: ["src/**/*.ts"],
      reporter: CI ? ["text", "json"] : ["text"],
      thresholds: {
        branches: 90,
        functions: 95,
        lines: 100,
        statements: 99,
      },
    },
  },
});
