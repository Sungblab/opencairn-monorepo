import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "./types";

const DEFAULT_WEB_ORIGIN = "http://localhost:3000";
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function splitOrigins(value: string | undefined): string[] {
  return (
    value
      ?.split(",")
      .map((s) => s.trim())
      .filter(Boolean) ?? []
  );
}

function normalizeOrigin(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function trustedOriginsFromEnv(
  source: NodeJS.ProcessEnv = process.env,
): string[] {
  const corsOrigins = splitOrigins(source.CORS_ORIGIN);
  const candidates = (
    corsOrigins.length ? corsOrigins : [source.WEB_URL, source.PUBLIC_WEB_URL]
  ).filter((v): v is string => Boolean(v));

  const normalized = candidates
    .map(normalizeOrigin)
    .filter((v): v is string => Boolean(v));

  return Array.from(
    new Set(normalized.length ? normalized : [DEFAULT_WEB_ORIGIN]),
  );
}

export function isTrustedOrigin(
  raw: string,
  source: NodeJS.ProcessEnv = process.env,
): boolean {
  const origin = normalizeOrigin(raw);
  if (!origin) return false;
  return trustedOriginsFromEnv(source).includes(origin);
}

function originFromHeaders(
  c: Parameters<MiddlewareHandler<AppEnv>>[0],
): string | null {
  const origin = c.req.header("Origin");
  if (origin) return origin;

  const referer = c.req.header("Referer");
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

function isInternalApiPath(pathname: string): boolean {
  return pathname === "/api/internal" || pathname.startsWith("/api/internal/");
}

function isFirstPartyFileViewerPath(pathname: string): boolean {
  return (
    /^\/api\/agent-files\/[0-9a-f-]+\/(?:file|compiled)$/i.test(pathname) ||
    /^\/api\/notes\/[0-9a-f-]+\/file$/i.test(pathname)
  );
}

function isTestRuntime(): boolean {
  return process.env.NODE_ENV === "test" || process.env.VITEST === "true";
}

export function csrfOriginGuard(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const method = c.req.method.toUpperCase();
    if (!UNSAFE_METHODS.has(method)) {
      await next();
      return;
    }

    const pathname = new URL(c.req.url).pathname;
    if (isInternalApiPath(pathname)) {
      await next();
      return;
    }

    const origin = originFromHeaders(c);
    if (!origin) {
      if (isTestRuntime()) {
        await next();
        return;
      }
      return c.json({ error: "forbidden" }, 403);
    }

    if (!isTrustedOrigin(origin)) {
      return c.json({ error: "forbidden" }, 403);
    }

    await next();
  };
}

export function securityHeaders(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    await next();
    const pathname = new URL(c.req.url).pathname;
    const allowFirstPartyFrame = isFirstPartyFileViewerPath(pathname);
    c.header("X-Content-Type-Options", "nosniff");
    c.header("X-Frame-Options", allowFirstPartyFrame ? "SAMEORIGIN" : "DENY");
    c.header("Referrer-Policy", "no-referrer");
    c.header("Cross-Origin-Resource-Policy", "same-site");
    c.header(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=(), payment=()",
    );
    c.header(
      "Content-Security-Policy",
      allowFirstPartyFrame
        ? "default-src 'none'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'"
        : "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    );
    if (process.env.NODE_ENV === "production") {
      c.header(
        "Strict-Transport-Security",
        "max-age=31536000; includeSubDomains",
      );
    }
  };
}
