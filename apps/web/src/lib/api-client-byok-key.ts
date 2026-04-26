// Tiny client-side wrapper for the BYOK Gemini key endpoints.
//
// Same-origin only. Browser fetches against `/api/users/me/byok-key`
// proxied to apps/api in dev and same-origin in prod. Do NOT call from
// a Server Component — those paths must hit `INTERNAL_API_URL` directly.
//
// Uses raw `fetch` rather than the shared apiClient helper because we
// surface a stable `code` field on errors (too_short / too_long /
// wrong_prefix / unknown) for i18n branching in <ByokKeyCard>. The
// generic ApiError only carries `status` + `error`, so a dedicated
// ByokKeyApiError class is cleaner than retrofitting.
//
// The discriminated union on `registered` keeps lastFour / updatedAt
// optional at the type level so consumers don't need null-checks for
// the empty case.

export type ByokKeyStatus =
  | { registered: false }
  | { registered: true; lastFour: string; updatedAt: string };

export class ByokKeyApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ByokKeyApiError";
  }
}

export const byokKeyQueryKey = () => ["byok-key"] as const;

const BASE = "/api/users/me/byok-key";

async function unwrap(res: Response): Promise<unknown> {
  if (res.ok) return res.json();
  let code = "unknown";
  try {
    const body = await res.json();
    if (typeof body === "object" && body && "code" in body) {
      code = String((body as { code: unknown }).code);
    }
  } catch {
    /* fallthrough */
  }
  throw new ByokKeyApiError(
    code,
    `byok-key request failed (${res.status} ${code})`,
  );
}

export async function getByokKey(): Promise<ByokKeyStatus> {
  const res = await fetch(BASE, {
    method: "GET",
    credentials: "include",
  });
  return (await unwrap(res)) as ByokKeyStatus;
}

export async function setByokKey(apiKey: string): Promise<ByokKeyStatus> {
  const res = await fetch(BASE, {
    method: "PUT",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ apiKey }),
  });
  return (await unwrap(res)) as ByokKeyStatus;
}

export async function deleteByokKey(): Promise<{ registered: false }> {
  const res = await fetch(BASE, {
    method: "DELETE",
    credentials: "include",
  });
  return (await unwrap(res)) as { registered: false };
}
