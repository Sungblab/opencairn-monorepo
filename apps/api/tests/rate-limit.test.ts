import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  checkRateLimit,
  _resetRateLimits,
  _bucketCountForTests,
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
});
