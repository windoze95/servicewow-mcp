import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    coverage: {
      provider: "v8",
      all: true,
      include: ["src/**/*.ts"],
      exclude: ["src/servicenow/types.ts", "src/tools/_template.ts"],
      reporter: ["text", "html", "json-summary"],
      thresholds: {
        statements: 57,
        branches: 82,
        functions: 92,
        lines: 57,
      },
    },
  },
});
