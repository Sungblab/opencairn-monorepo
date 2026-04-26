import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";

// Load the root .env so INTERNAL_API_SECRET / BETTER_AUTH_SECRET / etc. are
// available both in the test runner (for seeding) and when Playwright
// spawns the dev servers via the `webServer` block below. Uses Node 20+'s
// built-in `process.loadEnvFile` to avoid pulling `dotenv` into the web
// package just for tests.
try {
  process.loadEnvFile(resolve(__dirname, "../../.env"));
} catch {
  // .env missing is fine — env may already be exported by the shell (CI).
}

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // Both web (3000) and api (4000) must be up — the editor E2E seeds via
  // /api/internal/test-seed on the API, then drives the browser against
  // web. `reuseExistingServer` means running `pnpm dev` from the repo root
  // before `pnpm test:e2e` is the normal dev loop.
  webServer: [
    {
      command: "pnpm --filter @opencairn/web dev",
      url: "http://localhost:3000",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        ...process.env,
        FEATURE_DEEP_RESEARCH: "true",
      },
    },
    {
      command: "pnpm --filter @opencairn/api dev",
      url: "http://localhost:4000/api/health",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
