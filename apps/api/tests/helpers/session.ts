import { randomUUID, randomBytes } from "crypto";
import { serializeSigned } from "hono/utils/cookie";
import { db, session as sessionTable } from "@opencairn/db";

// Better Auth's session token cookie is a Hono signed cookie:
//   name: `better-auth.session_token` (no __Secure- prefix over HTTP)
//   value: `<token>.<HMAC-SHA256(token, BETTER_AUTH_SECRET)>` (URL-encoded)
// Better Auth's getSession(): parse signed cookie → token → SELECT from `session` table.
// We insert a real session row and emit a properly signed cookie — no production bypass.
//
// Note: Hono's `serializeSigned` returns a full Set-Cookie header (with attributes). For
// a request Cookie header we only need `name=value`, so we take the first segment.

const COOKIE_NAME = "better-auth.session_token";

function getSecret(): string {
  const s = process.env.BETTER_AUTH_SECRET;
  if (!s) throw new Error("BETTER_AUTH_SECRET not set — vitest.config.ts should load root .env");
  return s;
}

export async function signSessionCookie(userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7d

  await db.insert(sessionTable).values({
    id,
    token,
    userId,
    expiresAt,
  });

  const serialized = await serializeSigned(COOKIE_NAME, token, getSecret(), {
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
  });
  // `name=value; Path=/; HttpOnly; ...` → keep only `name=value`
  return serialized.split(";", 1)[0]!;
}
