// In-memory per-user concurrency lock for POST /api/visualize.
//
// Plan 5 Phase 2 §5.6 calls for a Redis-backed lock; the apps/api codebase
// has no Redis client today (only a single in-memory rate-limit module —
// `lib/rate-limit.ts`), so we mirror that approach here. Single API instance
// is the dev/self-host default (Plan 1 spec), and the lock's only job is
// preventing the same user from queuing two simultaneous LLM-spending
// visualize runs from the same browser. A multi-instance prod deployment
// will want to swap this for a Redis SET-NX before flag flip — same TODO
// pattern as rate-limit.ts.
//
// TTL guards against orphaned locks if the route handler dies mid-stream
// without hitting the release path: an entry older than `TTL_MS` is
// silently treated as released. Successful end-of-stream calls `release`
// explicitly so back-to-back visualizes from the same user work.

const inflight = new Map<string, number>();

const TTL_MS = 120_000;

export function tryAcquireVisualizeLock(userId: string): boolean {
  const now = Date.now();
  const heldAt = inflight.get(userId);
  if (heldAt !== undefined && now - heldAt < TTL_MS) return false;
  inflight.set(userId, now);
  return true;
}

export function releaseVisualizeLock(userId: string): void {
  inflight.delete(userId);
}

// Test-only helper — keeps suites isolated when the same user id repeats
// across cases. Never call from production paths.
export function _resetVisualizeLocks(): void {
  inflight.clear();
}
