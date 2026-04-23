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

// Lazy eviction + hard cap. Without sweeping, an attacker driving many unique
// keys (`invite:${ws}:${generated-uid}`) would leak memory indefinitely since
// entries are only touched when their key is revisited. Two layers guard this:
//
// 1. SWEEP_INTERVAL_MS throttles a full sweep so normal traffic pays O(n) at
//    most once per minute.
// 2. MAX_BUCKETS caps the map so a burst of unique keys cannot exceed a known
//    memory footprint even between sweeps. Once exceeded we force an eager
//    sweep; if expired entries alone don't bring size under the cap (all
//    buckets still within their window), the oldest-resetAt entries are
//    evicted FIFO. Dropping a live bucket resets that key's count — the
//    attacker only gains back a single window's worth of quota, so the
//    admission-control invariant holds.
const SWEEP_INTERVAL_MS = 60_000;
const DEFAULT_MAX_BUCKETS = 10_000;
let MAX_BUCKETS = DEFAULT_MAX_BUCKETS;
let lastSweepAt = 0;

function sweepExpired(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

function sweepIfDue(now: number): void {
  if (now - lastSweepAt < SWEEP_INTERVAL_MS) return;
  lastSweepAt = now;
  sweepExpired(now);
}

function enforceCap(now: number): void {
  if (buckets.size < MAX_BUCKETS) return;
  // Force a sweep regardless of SWEEP_INTERVAL_MS — memory pressure wins over
  // throttle. lastSweepAt is updated so sweepIfDue doesn't double-sweep this
  // call.
  lastSweepAt = now;
  sweepExpired(now);
  if (buckets.size < MAX_BUCKETS) return;
  // All buckets are live. Sort by resetAt and evict the oldest-expiring ones
  // until we fall back under the cap. Runs only when the map is already
  // saturated, so the O(n log n) is bounded by MAX_BUCKETS (<1ms at 10k).
  const entries = Array.from(buckets.entries());
  entries.sort((a, b) => a[1].resetAt - b[1].resetAt);
  const overflow = buckets.size - MAX_BUCKETS + 1;
  for (let i = 0; i < overflow; i += 1) buckets.delete(entries[i][0]);
}

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
  sweepIfDue(now);
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    // Enforce the hard cap before inserting — a new unique key is the only
    // path that grows the map, so checking here is sufficient.
    enforceCap(now);
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
// Also restores MAX_BUCKETS to the production default. Never call from
// production paths.
export function _resetRateLimits(): void {
  buckets.clear();
  lastSweepAt = 0;
  MAX_BUCKETS = DEFAULT_MAX_BUCKETS;
}

// Test-only accessor for the current bucket size — lets the sweep test
// observe the eviction side effect without reaching into the module.
export function _bucketCountForTests(): number {
  return buckets.size;
}

// Test-only override of the hard cap so tests can exercise the cap branch
// without having to insert 10_000 entries per run. _resetRateLimits restores
// the production default.
export function _setMaxBucketsForTests(n: number): void {
  MAX_BUCKETS = n;
}
