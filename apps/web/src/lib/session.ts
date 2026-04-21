// Server-only helper: read Better Auth session from cookies on the server side.
// Any /app/* route must be authed — unauthed hits redirect to /ko/auth/login.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export interface ServerSession {
  userId: string;
  email: string;
  name: string;
}

export async function requireSession(): Promise<ServerSession> {
  // Forward cookies to the API /auth/me endpoint (single source of truth
  // for session parsing; avoids duplicating Better Auth logic in web).
  const cookieHeader = (await cookies()).toString();
  const base = process.env.INTERNAL_API_URL ?? "http://localhost:4000";
  const res = await fetch(`${base}/api/auth/me`, {
    headers: { cookie: cookieHeader },
    cache: "no-store",
  });
  if (!res.ok) redirect("/ko/auth/login");
  const body = (await res.json()) as ServerSession;
  return body;
}
