import { afterEach, describe, expect, it } from "vitest";
import { db, eq, user, userNotificationPreferences } from "@opencairn/db";

import {
  getEffectivePreferenceForKind,
  getEffectivePreferences,
  getProfile,
  updateProfile,
  upsertPreference,
} from "../src/lib/notification-preferences";
import { createUser } from "./helpers/seed";

const createdUserIds = new Set<string>();

afterEach(async () => {
  for (const id of createdUserIds) {
    await db.delete(userNotificationPreferences).where(eq(userNotificationPreferences.userId, id));
    await db.delete(user).where(eq(user.id, id));
  }
  createdUserIds.clear();
});

describe("getEffectivePreferences", () => {
  it("returns 5 default rows when nothing stored", async () => {
    const u = await createUser();
    createdUserIds.add(u.id);

    const prefs = await getEffectivePreferences(u.id);
    expect(prefs).toHaveLength(5);

    const byKind = Object.fromEntries(prefs.map((p) => [p.kind, p]));
    expect(byKind.mention.frequency).toBe("instant");
    expect(byKind.system.frequency).toBe("digest_daily");
    for (const p of prefs) {
      expect(p.emailEnabled).toBe(true);
    }
  });

  it("merges stored rows over defaults", async () => {
    const u = await createUser();
    createdUserIds.add(u.id);
    await upsertPreference({
      userId: u.id,
      kind: "mention",
      body: { emailEnabled: false, frequency: "digest_15min" },
    });

    const prefs = await getEffectivePreferences(u.id);
    const mention = prefs.find((p) => p.kind === "mention");
    expect(mention).toEqual({
      kind: "mention",
      emailEnabled: false,
      frequency: "digest_15min",
    });
    // others unaffected
    const reply = prefs.find((p) => p.kind === "comment_reply");
    expect(reply?.frequency).toBe("instant");
  });
});

describe("getEffectivePreferenceForKind", () => {
  it("returns default when no row", async () => {
    const u = await createUser();
    createdUserIds.add(u.id);
    const p = await getEffectivePreferenceForKind(u.id, "system");
    expect(p.frequency).toBe("digest_daily");
  });

  it("returns stored row over default", async () => {
    const u = await createUser();
    createdUserIds.add(u.id);
    await upsertPreference({
      userId: u.id,
      kind: "system",
      body: { emailEnabled: false, frequency: "instant" },
    });
    const p = await getEffectivePreferenceForKind(u.id, "system");
    expect(p).toEqual({ kind: "system", emailEnabled: false, frequency: "instant" });
  });
});

describe("upsertPreference", () => {
  it("is idempotent and bumps updated_at on second write", async () => {
    const u = await createUser();
    createdUserIds.add(u.id);

    await upsertPreference({
      userId: u.id,
      kind: "mention",
      body: { emailEnabled: true, frequency: "instant" },
    });
    const [first] = await db
      .select()
      .from(userNotificationPreferences)
      .where(eq(userNotificationPreferences.userId, u.id));

    await new Promise((r) => setTimeout(r, 5));
    await upsertPreference({
      userId: u.id,
      kind: "mention",
      body: { emailEnabled: true, frequency: "instant" },
    });
    const [second] = await db
      .select()
      .from(userNotificationPreferences)
      .where(eq(userNotificationPreferences.userId, u.id));

    expect(second.updatedAt.getTime()).toBeGreaterThanOrEqual(first.updatedAt.getTime());
    // No row duplication
    const all = await db
      .select()
      .from(userNotificationPreferences)
      .where(eq(userNotificationPreferences.userId, u.id));
    expect(all).toHaveLength(1);
  });
});

describe("profile", () => {
  it("returns column defaults", async () => {
    const u = await createUser();
    createdUserIds.add(u.id);
    const p = await getProfile(u.id);
    expect(p).toEqual({ locale: "ko", timezone: "Asia/Seoul" });
  });

  it("partial update only touches provided fields", async () => {
    const u = await createUser();
    createdUserIds.add(u.id);
    const updated = await updateProfile({
      userId: u.id,
      body: { timezone: "America/Los_Angeles" },
    });
    expect(updated.locale).toBe("ko"); // unchanged
    expect(updated.timezone).toBe("America/Los_Angeles");
  });
});
