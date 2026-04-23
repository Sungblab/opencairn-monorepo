import type { APIRequestContext } from "@playwright/test";
import type { SeededSession } from "./seed-session";

const DEFAULT_API_BASE = process.env.API_BASE ?? "http://localhost:4000";

export interface CreatedNote {
  id: string;
  title: string;
}

/**
 * Create a note via the public POST /api/notes endpoint using the given
 * session's cookie. Used by the tab-system E2E spec to produce enough
 * sidebar entries for preview-replace / overflow coverage without
 * extending test-seed.
 */
export async function createNote(
  request: APIRequestContext,
  session: SeededSession,
  title: string,
): Promise<CreatedNote> {
  if (!session.projectId) {
    throw new Error("session missing projectId (wrong seed mode)");
  }
  const res = await request.post(`${DEFAULT_API_BASE}/api/notes`, {
    headers: {
      cookie: `${session.cookieName}=${session.cookieValue}`,
      "content-type": "application/json",
    },
    data: { projectId: session.projectId, title },
  });
  if (!res.ok()) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `POST /api/notes failed: ${res.status()} ${res.statusText()} ${body}`,
    );
  }
  const row = (await res.json()) as { id: string; title: string };
  return { id: row.id, title: row.title };
}
