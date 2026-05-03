import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    pool: "forks",
    environment: "node",
    testTimeout: 15000,
  },
  resolve: {
    conditions: ["development", "browser", "module", "import", "default"],
  },
});
