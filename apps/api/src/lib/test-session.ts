import { randomUUID, randomBytes } from "node:crypto";
import { serializeSigned } from "hono/utils/cookie";
import { db, session as sessionTable } from "@opencairn/db";

// Shared session-signing helper used by BOTH the Vitest helper
// (`apps/api/tests/helpers/session.ts`) AND the test-only seed endpoint in
// `routes/internal.ts`. Keeping a single codepath guarantees Playwright and
// the in-process API tests sign the same way.
//
// Better Auth's session token cookie:
//   name: `better-auth.session_token` (no __Secure- prefix over HTTP)
//   value: `<token>.<HMAC-SHA256(token, BETTER_AUTH_SECRET)>` (URL-encoded)
// Better Auth's getSession() parses the signed cookie → token → SELECT from
// `session` table. We insert a real session row and emit a properly signed
// cookie — no production bypass is added to Better Auth itself.

const COOKIE_NAME = "better-auth.session_token";

function getSecret(): string {
  const s = process.env.BETTER_AUTH_SECRET;
  if (!s) {
    throw new Error(
      "BETTER_AUTH_SECRET not set — required for session signing",
    );
  }
  return s;
}

/**
 * Sign a new session for `userId` and return BOTH the bare
 * `name=value` Cookie-header form (for in-process `app.request` tests) and
 * the full Set-Cookie header (for HTTP clients like Playwright that need
 * Path/HttpOnly attributes).
 */
export async function signSessionForUser(userId: string): Promise<{
  /** `name=value` — what a browser would send in a `Cookie:` header. */
  cookieHeader: string;
  /** Full `Set-Cookie` header, attributes included. */
  setCookie: string;
  /** Decomposed parts so callers can construct Playwright cookie objects. */
  name: string;
  value: string;
  expiresAt: Date;
}> {
  const token = randomBytes(32).toString("base64url");
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7d

  await db.insert(sessionTable).values({
    id,
    token,
    userId,
    expiresAt,
  });

  const setCookie = await serializeSigned(COOKIE_NAME, token, getSecret(), {
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    expires: expiresAt,
  });

  // `serializeSigned` returns the full Set-Cookie header; split off attrs
  // to get the raw `name=value` used for in-process `cookie: ...` headers.
  const cookieHeader = setCookie.split(";", 1)[0]!;
  const [name, ...valueParts] = cookieHeader.split("=");
  const value = valueParts.join("=");

  return { cookieHeader, setCookie, name: name!, value, expiresAt };
}
