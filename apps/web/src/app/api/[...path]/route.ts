// apps/web/src/app/api/[...path]/route.ts
// Next.js 16 — catch-all Route Handler forwards /api/* requests to Hono API.
// Needed because Better Auth cookies require same-origin; direct browser fetches
// to localhost:4000 from localhost:3000 would be cross-origin.
import { type NextRequest } from "next/server";
import { siteUrl } from "@/lib/site-config";

const API_BASE = process.env.INTERNAL_API_URL ?? "http://localhost:4000";

function isUnspecifiedHost(hostname: string): boolean {
  return hostname === "0.0.0.0" || hostname === "::" || hostname === "[::]";
}

function callbackRedirectOrigin(req: NextRequest): string {
  const requestOrigin = req.nextUrl.origin;
  if (!isUnspecifiedHost(req.nextUrl.hostname)) return requestOrigin;

  try {
    return new URL(siteUrl).origin;
  } catch {
    return requestOrigin;
  }
}

async function handler(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const url = `${API_BASE}/api/${path.join("/")}${req.nextUrl.search}`;

  // Forward request headers (cookies included)
  const headers = new Headers(req.headers);
  const forwardedFor = req.headers.get("x-forwarded-for") ?? "";
  if (forwardedFor) headers.set("x-forwarded-for", forwardedFor);
  headers.set("x-forwarded-host", req.headers.get("host") ?? "");

  const hasBody = req.method !== "GET" && req.method !== "HEAD";

  const response = await fetch(url, {
    method: req.method,
    headers,
    body: hasBody ? req.body : undefined,
    redirect: "manual",
    // Node 18+: streaming request bodies require `duplex: "half"`
    // TS DOM RequestInit may not declare this yet — suppress if tsc complains
    ...(hasBody ? { duplex: "half" } : {}),
  } as RequestInit & { duplex?: "half" });

  // Forward response headers including Set-Cookie. If the upstream response is
  // encoded, fetch may expose a decoded body while keeping encoded headers, so
  // drop both. Otherwise preserve Content-Length; PDF range readers rely on it.
  const resHeaders = new Headers(response.headers);
  if (resHeaders.has("content-encoding")) {
    resHeaders.delete("content-encoding");
    resHeaders.delete("content-length");
  }
  const setCookies =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [];
  if (setCookies.length > 0) {
    resHeaders.delete("set-cookie");
    for (const cookie of setCookies) {
      resHeaders.append("set-cookie", cookie);
    }
  }
  const isAuthCallback =
    req.method === "GET" &&
    path[0] === "auth" &&
    path[1] === "callback" &&
    response.status >= 200 &&
    response.status < 400;
  if (isAuthCallback) {
    const locale = req.cookies.get("NEXT_LOCALE")?.value === "en" ? "en" : "ko";
    const destination = new URL(
      `/${locale}/dashboard`,
      callbackRedirectOrigin(req),
    );
    const redirectHeaders = new Headers({ location: destination.toString() });
    for (const cookie of setCookies) {
      redirectHeaders.append("set-cookie", cookie);
    }
    return new Response(null, {
      status: 303,
      headers: redirectHeaders,
    });
  }

  return new Response(response.body, {
    status: response.status,
    headers: resHeaders,
  });
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
