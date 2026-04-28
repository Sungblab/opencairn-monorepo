import type { Context } from "hono";
import { captureError } from "../lib/sentry";

// Hono onError 핸들러 — app.use('*', ...) 가 아니라 app.onError()에 등록
export function errorHandler(err: Error, c: Context) {
  // production에서 내부 에러 메시지 노출 금지 (보안 리뷰 M-1)
  const isProd = process.env.NODE_ENV === "production";
  const message = isProd ? "Internal server error" : err.message;
  console.error("[API Error]", err.name, isProd ? "(hidden in prod)" : err.message);
  // Forward to Sentry when configured. captureError is a no-op when
  // SENTRY_DSN is unset, so this is safe in OSS / dev installs.
  captureError(err);
  return c.json({ error: message }, 500);
}
