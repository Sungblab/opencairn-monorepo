import { describe, expect, it } from "vitest";

import {
  DEFAULT_PREFERENCES,
  NotificationFrequencySchema,
  NotificationKindSchema,
  NotificationPreferenceSchema,
  NotificationPreferenceUpsertSchema,
  NotificationProfileSchema,
  NotificationProfileUpdateSchema,
  type NotificationFrequency,
  type NotificationKind,
} from "../src/notifications";

describe("notification frequency schema", () => {
  it("exposes the three frequency modes in order", () => {
    expect(NotificationFrequencySchema.options).toEqual([
      "instant",
      "digest_15min",
      "digest_daily",
    ]);
  });

  it("rejects unknown values", () => {
    expect(NotificationFrequencySchema.safeParse("hourly").success).toBe(false);
  });
});

describe("notification kind schema", () => {
  it("matches the DB enum", () => {
    expect(NotificationKindSchema.options).toEqual([
      "mention",
      "comment_reply",
      "research_complete",
      "share_invite",
      "system",
    ]);
  });
});

describe("preference schemas", () => {
  it("parses a complete preference row", () => {
    const parsed = NotificationPreferenceSchema.parse({
      kind: "mention",
      emailEnabled: true,
      frequency: "instant",
    });
    expect(parsed.kind).toBe("mention");
  });

  it("rejects mismatched frequency", () => {
    const r = NotificationPreferenceSchema.safeParse({
      kind: "mention",
      emailEnabled: true,
      frequency: "weekly",
    });
    expect(r.success).toBe(false);
  });

  it("upsert schema does not require kind in body", () => {
    const r = NotificationPreferenceUpsertSchema.parse({
      emailEnabled: false,
      frequency: "digest_daily",
    });
    expect(r.emailEnabled).toBe(false);
  });
});

describe("profile schemas", () => {
  it("parses ko/en + a known timezone", () => {
    expect(
      NotificationProfileSchema.parse({ locale: "ko", timezone: "Asia/Seoul" }),
    ).toEqual({ locale: "ko", timezone: "Asia/Seoul" });
  });

  it("rejects unsupported locale", () => {
    expect(
      NotificationProfileSchema.safeParse({ locale: "fr", timezone: "Asia/Seoul" })
        .success,
    ).toBe(false);
  });

  it("update schema permits partial body", () => {
    expect(NotificationProfileUpdateSchema.parse({ locale: "en" })).toEqual({
      locale: "en",
    });
    expect(NotificationProfileUpdateSchema.parse({})).toEqual({});
  });

  it("rejects unknown timezone strings", () => {
    expect(
      NotificationProfileUpdateSchema.safeParse({ timezone: "Mars/Olympus" })
        .success,
    ).toBe(false);
  });
});

describe("default preferences", () => {
  it("covers all five kinds", () => {
    const kinds = Object.keys(DEFAULT_PREFERENCES) as NotificationKind[];
    expect(new Set(kinds)).toEqual(
      new Set([
        "mention",
        "comment_reply",
        "research_complete",
        "share_invite",
        "system",
      ]),
    );
  });

  it("defaults system to digest_daily and the rest to instant", () => {
    const sys = DEFAULT_PREFERENCES.system;
    const mention = DEFAULT_PREFERENCES.mention;
    expect(sys.emailEnabled).toBe(true);
    expect(sys.frequency).toBe<NotificationFrequency>("digest_daily");
    expect(mention.frequency).toBe<NotificationFrequency>("instant");
  });
});
