import type { APIRequestContext, BrowserContext } from "@playwright/test";

// Response shape from POST /api/internal/test-seed — matches
// apps/api/src/routes/internal.ts.
export interface SeededSession {
  userId: string;
  wsSlug: string;
  workspaceId: string;
  projectId: string;
  noteId: string;
  /** Full Set-Cookie header emitted by the API. */
  sessionCookie: string;
  /** Decomposed cookie so callers can skip re-parsing. */
  cookieName: string;
  cookieValue: string;
  expiresAt: string;
}

const DEFAULT_API_BASE = process.env.API_BASE ?? "http://localhost:4000";

/**
 * Hit the test-only seed endpoint and return the fresh fixture + session.
 * Throws if `INTERNAL_API_SECRET` isn't configured — the request would 401
 * anyway and the error message is more useful this way.
 */
export async function seedAndSignIn(
  request: APIRequestContext,
  opts: { apiBase?: string } = {},
): Promise<SeededSession> {
  const apiBase = opts.apiBase ?? DEFAULT_API_BASE;
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) {
    throw new Error(
      "INTERNAL_API_SECRET not set — required for E2E seed. " +
        "Export it (or source .env) before running playwright.",
    );
  }

  const res = await request.post(`${apiBase}/api/internal/test-seed`, {
    headers: {
      "x-internal-secret": secret,
      "content-type": "application/json",
    },
    data: {},
  });
  if (!res.ok()) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `test-seed failed: ${res.status()} ${res.statusText()} ${body}`,
    );
  }
  return (await res.json()) as SeededSession;
}

/**
 * Attach the Better Auth session cookie to a Playwright browser context so
 * subsequent `page.goto(...)` calls arrive authenticated. Infers the
 * target host from `baseURL` (defaults to `localhost`) — Playwright requires
 * the domain match to accept the cookie.
 */
export async function applySessionCookie(
  context: BrowserContext,
  session: SeededSession,
  opts: { host?: string } = {},
): Promise<void> {
  const host = opts.host ?? "localhost";
  await context.addCookies([
    {
      name: session.cookieName,
      value: session.cookieValue,
      domain: host,
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
      expires: Math.floor(new Date(session.expiresAt).getTime() / 1000),
    },
  ]);
}
