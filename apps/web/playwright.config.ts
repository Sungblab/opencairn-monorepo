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

const repoRoot = resolve(__dirname, "../..");
const webUrl = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const apiUrl = process.env.API_BASE ?? "http://localhost:4000";
const reuseExistingServer =
  !process.env.CI && process.env.OPENCAIRN_E2E_REUSE_SERVERS !== "0";
const allowLiveLlm = process.env.OPENCAIRN_E2E_ALLOW_LLM === "1";
const mockApiSpecs = [
  "plan-2d-save-suggestion.spec.ts",
  "source-viewer-smoke.spec.ts",
  "live-ingest-visualization.spec.ts",
];
const useMockApi =
  process.env.OPENCAIRN_E2E_MOCK_API === "1" ||
  mockApiSpecs.some((spec) => process.argv.some((arg) => arg.includes(spec)));

// Keep full-stack E2E runnable on a fresh dev shell. Real infra still needs
// Postgres/Redis/etc.; these defaults only cover app secrets and local URLs.
process.env.INTERNAL_API_SECRET ??= "opencairn-e2e-internal-secret";
process.env.BETTER_AUTH_SECRET ??= "opencairn-e2e-better-auth-secret";
process.env.BETTER_AUTH_URL ??= apiUrl;
process.env.INTERNAL_API_URL ??= apiUrl;
process.env.CORS_ORIGIN ??= webUrl;
process.env.DATABASE_URL ??=
  "postgresql://opencairn:changeme-dev-only@localhost:5432/opencairn";
process.env.REDIS_URL ??= "redis://localhost:6379";

const serverEnv = {
  ...process.env,
  BETTER_AUTH_URL: apiUrl,
  INTERNAL_API_URL: apiUrl,
  CORS_ORIGIN: webUrl,
  // Default to a deterministic "LLM unavailable" smoke path so E2E never
  // burns Gemini tokens. Set OPENCAIRN_E2E_ALLOW_LLM=1 for live LLM runs.
  GEMINI_API_KEY: allowLiveLlm ? (process.env.GEMINI_API_KEY ?? "") : "",
  GOOGLE_API_KEY: allowLiveLlm ? (process.env.GOOGLE_API_KEY ?? "") : "",
};

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: webUrl,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // Both web (3000) and api (4000) must be up. Local runs reuse existing
  // servers by default; set OPENCAIRN_E2E_REUSE_SERVERS=0 to make Playwright
  // spawn a controlled full-stack pair with the env above.
  webServer: [
    {
      command: "pnpm --filter @opencairn/web exec next dev --webpack --port 3000",
      cwd: repoRoot,
      url: webUrl,
      reuseExistingServer,
      timeout: 120_000,
      env: {
        ...serverEnv,
        FEATURE_DEEP_RESEARCH: "true",
        NEXT_PUBLIC_FEATURE_LIVE_INGEST: "true",
      },
    },
    {
      command: useMockApi
        ? "node apps/web/tests/e2e/fixtures/mock-api-server.mjs"
        : "pnpm --filter @opencairn/api exec tsx watch src/index.ts",
      cwd: repoRoot,
      url: `${apiUrl}/api/health`,
      reuseExistingServer,
      timeout: 120_000,
      env: {
        ...serverEnv,
        PORT: String(new URL(apiUrl).port || 4000),
      },
    },
  ],
});
