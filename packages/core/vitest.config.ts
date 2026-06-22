import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
      // fakes.ts is test-support code — it contains no production logic and is
      // exercised by downstream task tests (agent, e2e), not by unit tests here.
      exclude: ["src/**/*.test.ts", "src/test-utils.ts", "src/fakes.ts"],
    },
  },
});
