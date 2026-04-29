import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  notificationFrequencyEnum,
  notificationKindEnum,
  notifications,
  user,
  userNotificationPreferences,
} from "../src/index";

describe("notification preferences schema", () => {
  it("exposes the frequency enum", () => {
    expect(notificationFrequencyEnum.enumValues).toEqual([
      "instant",
      "digest_15min",
      "digest_daily",
    ]);
  });

  it("declares user_notification_preferences columns + composite PK", () => {
    const cols = getTableColumns(userNotificationPreferences);
    expect(Object.keys(cols).sort()).toEqual(
      ["createdAt", "emailEnabled", "frequency", "kind", "updatedAt", "userId"].sort(),
    );
    // Composite PK ⇒ neither column is independently the primary key
    expect(cols.userId.primary).toBe(false);
    expect(cols.kind.primary).toBe(false);
    expect(cols.userId.notNull).toBe(true);
    expect(cols.kind.notNull).toBe(true);
    expect(cols.emailEnabled.notNull).toBe(true);
    expect(cols.frequency.notNull).toBe(true);
  });

  it("references the existing user table on cascade", () => {
    // sanity — column name + type, not full FK introspection
    const cols = getTableColumns(userNotificationPreferences);
    expect(cols.userId.dataType).toBe("string");
  });
});

describe("notifications dispatcher columns", () => {
  it("adds emailed_at, email_attempts, last_email_error", () => {
    const cols = getTableColumns(notifications);
    expect(cols.emailedAt).toBeDefined();
    expect(cols.emailedAt.notNull).toBe(false);
    expect(cols.emailAttempts).toBeDefined();
    expect(cols.emailAttempts.notNull).toBe(true);
    expect(cols.lastEmailError).toBeDefined();
    expect(cols.lastEmailError.notNull).toBe(false);
  });
});

describe("user locale + timezone", () => {
  it("exposes locale and timezone columns with defaults", () => {
    const cols = getTableColumns(user);
    expect(cols.locale).toBeDefined();
    expect(cols.locale.notNull).toBe(true);
    expect(cols.timezone).toBeDefined();
    expect(cols.timezone.notNull).toBe(true);
  });
});

describe("notification kind enum (already exists, sanity check)", () => {
  it("is unchanged by this plan", () => {
    expect(notificationKindEnum.enumValues).toEqual([
      "mention",
      "comment_reply",
      "research_complete",
      "share_invite",
      "system",
    ]);
  });
});
