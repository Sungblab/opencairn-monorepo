// apps/web/src/lib/api-client.ts
// Browser: same-origin (/api/... → proxied to Hono)
// Server Components: direct to internal API URL

export async function apiClient<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const base =
    typeof window === "undefined"
      ? (process.env.INTERNAL_API_URL ?? "http://localhost:4000")
      : "";

  const res = await fetch(`${base}/api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `API error ${res.status}`);
  }

  return res.json();
}
