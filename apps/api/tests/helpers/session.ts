import { signSessionForUser } from "../../src/lib/test-session.js";

// Thin wrapper kept for backwards-compat with existing Vitest tests —
// they want a single `name=value` string to stuff into a Cookie header when
// calling `app.request(...)`. See `src/lib/test-session.ts` for the
// cross-consumer (tests + /api/internal/test-seed) impl.
export async function signSessionCookie(userId: string): Promise<string> {
  const { cookieHeader } = await signSessionForUser(userId);
  return cookieHeader;
}
