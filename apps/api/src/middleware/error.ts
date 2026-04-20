import type { Context } from "hono";

// Hono onError 핸들러 — app.use('*', ...) 가 아니라 app.onError()에 등록
export function errorHandler(err: Error, c: Context) {
  // production에서 내부 에러 메시지 노출 금지 (보안 리뷰 M-1)
  const isProd = process.env.NODE_ENV === "production";
  const message = isProd ? "Internal server error" : err.message;
  console.error("[API Error]", err.name, isProd ? "(hidden in prod)" : err.message);
  return c.json({ error: message }, 500);
}
