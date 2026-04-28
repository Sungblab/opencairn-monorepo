import {
  expect,
  type APIRequestContext,
  type BrowserContext,
} from "@playwright/test";

import {
  applySessionCookie,
  seedAndSignIn,
  type SeedMode,
  type SeededSession,
} from "./seed-session";

const API_BASE = process.env.API_BASE ?? "http://localhost:4000";

const REQUIRED_SERVICES = [
  `api dev server: ${API_BASE}/api/health`,
  "web dev server: http://localhost:3000 or PLAYWRIGHT_BASE_URL",
  "postgres from docker-compose.yml, with migrations applied",
  "redis/minio when the exercised route needs them",
  "INTERNAL_API_SECRET shared by Playwright and apps/api",
].join("\n- ");

export async function expectApiHealthy(
  request: APIRequestContext,
): Promise<void> {
  const res = await request.get(`${API_BASE}/api/health`, { timeout: 10_000 });
  expect(
    res.ok(),
    `API health check failed (${res.status()} ${res.statusText()}).\n` +
      `Required full-stack services:\n- ${REQUIRED_SERVICES}`,
  ).toBe(true);
}

export async function seedFullStackSession(
  request: APIRequestContext,
  context: BrowserContext,
  opts: { mode?: SeedMode; host?: string } = {},
): Promise<SeededSession> {
  await expectApiHealthy(request);
  try {
    const session = await seedAndSignIn(request, { mode: opts.mode });
    await applySessionCookie(context, session, { host: opts.host });
    return session;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Full-stack seed failed: ${message}\n` +
        `Required full-stack services:\n- ${REQUIRED_SERVICES}`,
    );
  }
}
