import { describe, expect, it } from "vitest";

import { dueForFrequency } from "../../src/lib/email-dispatcher";

const u = (timezone: string) => ({ timezone });

describe("dueForFrequency", () => {
  it("instant is always due", () => {
    for (const t of [
      "2026-04-29T00:01:00Z",
      "2026-04-29T00:14:00Z",
      "2026-04-29T12:31:23Z",
    ]) {
      expect(dueForFrequency("instant", new Date(t), u("Asia/Seoul"))).toBe(true);
    }
  });

  describe("digest_15min", () => {
    it.each([
      ["2026-04-29T00:00:00Z", true],
      ["2026-04-29T00:15:00Z", true],
      ["2026-04-29T00:30:00Z", true],
      ["2026-04-29T00:45:00Z", true],
      ["2026-04-29T12:30:00Z", true],
      ["2026-04-29T00:01:00Z", false],
      ["2026-04-29T00:14:00Z", false],
      ["2026-04-29T00:16:00Z", false],
      ["2026-04-29T00:46:00Z", false],
    ])("%s → %s", (iso, expected) => {
      expect(dueForFrequency("digest_15min", new Date(iso), u("Asia/Seoul"))).toBe(expected);
    });
  });

  describe("digest_daily", () => {
    it("fires at 09:00 in user's timezone (Asia/Seoul)", () => {
      // 09:00 KST == 00:00 UTC
      const t = new Date("2026-04-29T00:00:00Z");
      expect(dueForFrequency("digest_daily", t, u("Asia/Seoul"))).toBe(true);
    });

    it("does not fire at 09:00 UTC for an Asia/Seoul user", () => {
      const t = new Date("2026-04-29T09:00:00Z");
      expect(dueForFrequency("digest_daily", t, u("Asia/Seoul"))).toBe(false);
    });

    it("fires at 09:00 LA time (handles DST — PDT=UTC-7)", () => {
      // 2026-04-29 is DST → PDT (UTC-7). 09:00 PDT == 16:00 UTC.
      const t = new Date("2026-04-29T16:00:00Z");
      expect(dueForFrequency("digest_daily", t, u("America/Los_Angeles"))).toBe(true);
    });

    it("fires at 09:00 LA time in winter (PST=UTC-8)", () => {
      // 2026-01-15 is non-DST → PST (UTC-8). 09:00 PST == 17:00 UTC.
      const t = new Date("2026-01-15T17:00:00Z");
      expect(dueForFrequency("digest_daily", t, u("America/Los_Angeles"))).toBe(true);
    });

    it("does not fire at 09:01 (off the minute)", () => {
      const t = new Date("2026-04-29T00:01:00Z");
      expect(dueForFrequency("digest_daily", t, u("Asia/Seoul"))).toBe(false);
    });
  });
});
