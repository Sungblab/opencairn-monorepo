import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getRedis, resetRedisForTest } from "../src/lib/redis.js";

describe("getRedis", () => {
  let originalEnv: string | undefined;
  beforeEach(() => {
    originalEnv = process.env.REDIS_URL;
    resetRedisForTest();
  });
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = originalEnv;
    resetRedisForTest();
  });

  it("throws when REDIS_URL is missing", () => {
    delete process.env.REDIS_URL;
    expect(() => getRedis()).toThrow(/REDIS_URL/);
  });

  it("returns a singleton instance on repeated calls", () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    const a = getRedis();
    const b = getRedis();
    expect(a).toBe(b);
    a.disconnect();
  });
});
