import { randomUUID } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { apiRequestLogs, db } from "@opencairn/db";
import type { AppEnv } from "../lib/types";

function header(c: Parameters<MiddlewareHandler<AppEnv>>[0], name: string) {
  return c.req.header(name) ?? null;
}

function clientIp(c: Parameters<MiddlewareHandler<AppEnv>>[0]) {
  return (
    header(c, "x-forwarded-for")?.split(",")[0]?.trim() ??
    header(c, "x-real-ip") ??
    null
  );
}

export function apiRequestLogger(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const url = new URL(c.req.url);
    const disabledInTest =
      (process.env.NODE_ENV === "test" || process.env.VITEST === "true") &&
      process.env.API_REQUEST_LOGGING_ENABLED !== "true";
    if (disabledInTest || !url.pathname.startsWith("/api/")) {
      await next();
      return;
    }

    const requestId = c.req.header("x-request-id") ?? randomUUID();
    const started = Date.now();
    let statusCode = 500;
    try {
      await next();
      statusCode = c.res.status;
    } catch (err) {
      statusCode = c.res?.status && c.res.status >= 400 ? c.res.status : 500;
      throw err;
    } finally {
      let userId: string | null = null;
      try {
        userId = c.get("userId") ?? null;
      } catch {
        userId = null;
      }
      try {
        await db.insert(apiRequestLogs).values({
          requestId,
          method: c.req.method,
          path: url.pathname,
          query: url.search ? url.search.slice(1) : null,
          statusCode,
          durationMs: Math.max(0, Date.now() - started),
          userId,
          ip: clientIp(c),
          userAgent: header(c, "user-agent"),
          referer: header(c, "referer"),
        });
      } catch (err) {
        console.warn("api_request_log_failed", err);
      }
    }
  };
}
