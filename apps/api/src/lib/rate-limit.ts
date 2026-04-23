// In-memory fixed-window rate limiter. Keyed per-bucket (caller builds the
// key — usually `${route}:${workspaceId}:${userId}`) and scoped to a single
// API process. Multi-instance deployment will need a shared store (Redis or
// Better Auth's DB-backed limiter) — tracked as Tier 1 follow-up.
//
// Added for Tier 0 item 0-4 (Plan 1 C-5): the invite POST endpoint had no
// upper bound, letting an admin email-bomb arbitrary addresses. A bucket of
// 10 invites per 60s is comfortably above legitimate usage while capping the
// damage a compromised account can inflict.

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSec: number;
}

export function checkRateLimit(
  key: string,
  max: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSec: 0 };
  }
  if (bucket.count >= max) {
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }
  bucket.count += 1;
  return { allowed: true, retryAfterSec: 0 };
}

// Test-only: reset every bucket so suites do not contaminate each other.
// Never call from production paths.
export function _resetRateLimits(): void {
  buckets.clear();
}
