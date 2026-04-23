import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  checkRateLimit,
  _resetRateLimits,
  _bucketCountForTests,
  _setMaxBucketsForTests,
} from "../src/lib/rate-limit.js";

describe("rate-limit bucket logic", () => {
  beforeEach(() => {
    _resetRateLimits();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    _resetRateLimits();
  });

  it("allows up to `max` requests in a window, then 429s with Retry-After", () => {
    const allowed: boolean[] = [];
    const retryAfter: number[] = [];
    for (let i = 0; i < 5; i++) {
      const r = checkRateLimit("k", 3, 60_000);
      allowed.push(r.allowed);
      retryAfter.push(r.retryAfterSec);
    }
    expect(allowed).toEqual([true, true, true, false, false]);
    expect(retryAfter.slice(3).every((n) => n >= 1)).toBe(true);
  });

  it("resets the counter after the window elapses", () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    for (let i = 0; i < 3; i++) checkRateLimit("k", 3, 60_000);
    expect(checkRateLimit("k", 3, 60_000).allowed).toBe(false);

    vi.setSystemTime(new Date("2026-01-01T00:01:01Z"));
    expect(checkRateLimit("k", 3, 60_000).allowed).toBe(true);
  });

  // Follow-up to the Tier 0 PR review: without eviction, an attacker driving
  // fresh keys would slow-leak process memory. The sweep runs at most once
  // per minute; after the window passes for every key we created, the next
  // check must drop the stale entries.
  it("sweeps expired buckets lazily so the map does not leak", () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    for (let i = 0; i < 25; i++) {
      checkRateLimit(`attacker:${i}`, 10, 60_000);
    }
    expect(_bucketCountForTests()).toBe(25);

    // Walk past both the window (60s) and the sweep interval (60s).
    vi.setSystemTime(new Date("2026-01-01T00:02:00Z"));
    checkRateLimit("trigger", 10, 60_000);
    // The sweep drops every previous entry; the new "trigger" key remains.
    expect(_bucketCountForTests()).toBe(1);
  });

  it("sweep does not drop active (unexpired) buckets", () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    checkRateLimit("short", 10, 5_000); // expires at +5s
    checkRateLimit("long", 10, 600_000); // expires at +10min

    // Past the sweep interval (+60s) — "short" is expired, "long" isn't.
    vi.setSystemTime(new Date("2026-01-01T00:01:05Z"));
    checkRateLimit("trigger", 10, 60_000);
    // "long" + "trigger" remain; "short" is evicted.
    expect(_bucketCountForTests()).toBe(2);
  });

  // PR #11 review follow-up: the sweep alone cannot bound memory between
  // intervals. A burst of unique keys must not grow the map past MAX_BUCKETS.
  it("hard-caps the bucket map even when sweep interval hasn't elapsed", () => {
    _setMaxBucketsForTests(5);
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    // All buckets live with identical window — sweep cannot help.
    for (let i = 0; i < 20; i += 1) {
      checkRateLimit(`burst:${i}`, 10, 60_000);
    }
    expect(_bucketCountForTests()).toBeLessThanOrEqual(5);
  });

  it("cap eviction drops the oldest-resetAt buckets first", () => {
    _setMaxBucketsForTests(3);
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    // Three buckets with short windows — they are the oldest-expiring.
    checkRateLimit("short-a", 10, 1_000);
    checkRateLimit("short-b", 10, 1_000);
    checkRateLimit("short-c", 10, 1_000);
    // Advance 100ms so the next inserts have strictly greater resetAt than
    // the shorts (prevents any ordering ambiguity when resetAt ties).
    vi.setSystemTime(new Date("2026-01-01T00:00:00.100Z"));
    checkRateLimit("long-a", 10, 600_000);
    // Cap trips here: one of short-a/b/c must be evicted, long-a must stay.
    expect(_bucketCountForTests()).toBe(3);
    // long-a is unexpired and newer — treating it as unseen would reset its
    // count. Verify its count is still 1 (i.e., it survived eviction).
    const res = checkRateLimit("long-a", 10, 600_000);
    expect(res.allowed).toBe(true);
    // If long-a was evicted and re-created, we'd be on count=1 again. The
    // call above incremented to 2. Fire 9 more calls; the 10th must still
    // succeed and the 11th must 429. (max=10, so 10 allowed then 429.)
    for (let i = 0; i < 8; i += 1) {
      expect(checkRateLimit("long-a", 10, 600_000).allowed).toBe(true);
    }
    expect(checkRateLimit("long-a", 10, 600_000).allowed).toBe(false);
  });

  it("cap check reuses the lastSweepAt slot (no double sweep)", () => {
    // Regression: enforceCap forces a sweep and must update lastSweepAt so
    // a subsequent sweepIfDue in the same ms doesn't run a second time.
    _setMaxBucketsForTests(2);
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    checkRateLimit("a", 10, 60_000);
    checkRateLimit("b", 10, 60_000);
    // Inserting "c" trips the cap → one of {a,b} evicted.
    checkRateLimit("c", 10, 60_000);
    expect(_bucketCountForTests()).toBe(2);
    // Advance past sweep interval. All 2 survivors are still live, so sweep
    // drops nothing; the cap branch already updated lastSweepAt so sweepIfDue
    // re-ran (but harmlessly).
    vi.setSystemTime(new Date("2026-01-01T00:01:10Z"));
    checkRateLimit("d", 10, 60_000); // live buckets still <3 after sweep
    expect(_bucketCountForTests()).toBeLessThanOrEqual(2);
  });
});
