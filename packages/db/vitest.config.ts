import { defineConfig } from "vitest/config";
import { configDotenv } from "dotenv";
import { resolve } from "path";

// Load the root .env while Vitest evaluates config so @opencairn/db's eager
// postgres singleton sees DATABASE_URL before any test module imports it.
configDotenv({ path: resolve(__dirname, "../../.env") });

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
