import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  db,
  eq,
  inArray,
  isNull,
  notifications,
  sql,
  user,
  userNotificationPreferences,
} from "@opencairn/db";

vi.mock("../../src/lib/email", () => ({
  sendEmail: vi.fn(),
  getEmailProvider: () => "console",
}));

import { sendEmail } from "../../src/lib/email";
import { _internals, runDispatcherTick } from "../../src/lib/email-dispatcher";
import { upsertPreference } from "../../src/lib/notification-preferences";
import { createUser } from "../helpers/seed";

const sendMock = sendEmail as unknown as ReturnType<typeof vi.fn>;

const createdUserIds = new Set<string>();
const createdNotifIds = new Set<string>();
const TEST_LOCK_KEY =
  9223372036854700000n + BigInt(Math.floor(Math.random() * 50_000));

function runTestDispatcherTick(opts: { now?: Date } = {}) {
  return runDispatcherTick({ ...opts, lockKey: TEST_LOCK_KEY });
}

afterEach(async () => {
  if (createdNotifIds.size) {
    await db
      .delete(notifications)
      .where(inArray(notifications.id, [...createdNotifIds]));
    createdNotifIds.clear();
  }
  for (const id of createdUserIds) {
    await db.delete(userNotificationPreferences).where(eq(userNotificationPreferences.userId, id));
    await db.delete(user).where(eq(user.id, id));
  }
  createdUserIds.clear();
  sendMock.mockReset();
  sendMock.mockResolvedValue(undefined);
});

beforeEach(async () => {
  await db.execute(sql`
    DELETE FROM notifications n
     WHERE NOT EXISTS (
       SELECT 1 FROM "user" u WHERE u.id = n.user_id
     )
  `);
  sendMock.mockResolvedValue(undefined);
});

interface SeededRow {
  id: string;
}

async function seedNotification(opts: {
  userId: string;
  kind: "mention" | "comment_reply" | "share_invite" | "research_complete" | "system";
  payload: Record<string, unknown>;
  agedSeconds?: number;
}): Promise<SeededRow> {
  const aged = opts.agedSeconds ?? 60;
  const created = new Date(Date.now() - aged * 1000);
  const [row] = await db
    .insert(notifications)
    .values({
      userId: opts.userId,
      kind: opts.kind,
      payload: opts.payload,
      createdAt: created,
    })
    .returning({ id: notifications.id });
  createdNotifIds.add(row.id);
  return row;
}

describe("runDispatcherTick", () => {
  it("normalizes WEB_BASE_URL before composing deep links", () => {
    expect(_internals.cleanWebBaseUrl("https://example.com///")).toBe(
      "https://example.com",
    );
  });

  it("acquires the lock and reports zero work when there is nothing pending", async () => {
    const result = await runTestDispatcherTick({ now: new Date(Date.now() + 1000) });
    expect(result.lockAcquired).toBe(true);
    expect(result.instantSent).toBe(0);
    expect(result.digestSent).toBe(0);
  });

  it("sends an instant email and marks emailed_at", async () => {
    const u = await createUser();
    createdUserIds.add(u.id);
    const seeded = await seedNotification({
      userId: u.id,
      kind: "mention",
      payload: { fromName: "Yejin", noteTitle: "프로젝트 회의록", noteId: "00000000-0000-0000-0000-000000000abc" },
    });

    const result = await runTestDispatcherTick();
    expect(result.lockAcquired).toBe(true);
    expect(result.instantSent).toBe(1);
    expect(sendMock).toHaveBeenCalledTimes(1);

    const [row] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.id, seeded.id));
    expect(row.emailedAt).not.toBeNull();
    expect(row.lastEmailError).toBeNull();
  });

  it("respects the 30s grace window — fresh rows are skipped", async () => {
    const u = await createUser();
    createdUserIds.add(u.id);
    await seedNotification({
      userId: u.id,
      kind: "mention",
      payload: { summary: "hello" },
      agedSeconds: 5,
    });

    const result = await runTestDispatcherTick();
    expect(result.instantSent).toBe(0);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("finalizes a row whose recipient turned email off (without sending)", async () => {
    const u = await createUser();
    createdUserIds.add(u.id);
    await upsertPreference({
      userId: u.id,
      kind: "system",
      body: { emailEnabled: false, frequency: "instant" },
    });
    const seeded = await seedNotification({
      userId: u.id,
      kind: "system",
      payload: { summary: "weekly notice" },
    });

    const result = await runTestDispatcherTick();
    expect(result.skipped).toBe(1);
    expect(sendMock).not.toHaveBeenCalled();

    const [row] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.id, seeded.id));
    expect(row.emailedAt).not.toBeNull();
    expect(row.lastEmailError).toBe("disabled");
  });

  it("increments email_attempts on send failure without setting emailed_at", async () => {
    const u = await createUser();
    createdUserIds.add(u.id);
    sendMock.mockRejectedValueOnce(new Error("smtp blew up"));
    const seeded = await seedNotification({
      userId: u.id,
      kind: "mention",
      payload: { fromName: "Sungbin", noteTitle: "test" },
    });

    const result = await runTestDispatcherTick();
    expect(result.errors).toBe(1);
    const [row] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.id, seeded.id));
    expect(row.emailedAt).toBeNull();
    expect(row.emailAttempts).toBe(1);
    expect(row.lastEmailError).toBe("smtp blew up");
  });

  it("digests are held back until the wallclock boundary", async () => {
    const u = await createUser();
    createdUserIds.add(u.id);
    await upsertPreference({
      userId: u.id,
      kind: "mention",
      body: { emailEnabled: true, frequency: "digest_15min" },
    });
    await seedNotification({
      userId: u.id,
      kind: "mention",
      payload: { fromName: "X", noteTitle: "T" },
    });
    await seedNotification({
      userId: u.id,
      kind: "mention",
      payload: { fromName: "Y", noteTitle: "T2" },
    });

    // Off-boundary: nothing fires. Use a future timestamp so the cutoff
    // includes our just-seeded rows, then pin the minute to non-multiple-of-15.
    const off = await runTestDispatcherTick({
      now: new Date(Date.UTC(2099, 0, 1, 0, 7, 0)),
    });
    expect(off.digestSent).toBe(0);
    expect(off.skipped).toBe(2);
    expect(sendMock).not.toHaveBeenCalled();

    // On boundary :15 → both rows ship in one digest.
    const on = await runTestDispatcherTick({
      now: new Date(Date.UTC(2099, 0, 1, 0, 15, 0)),
    });
    expect(on.digestSent).toBe(2);
    expect(sendMock).toHaveBeenCalledTimes(1);
    const [, args] = sendMock.mock.calls[0] ?? [, undefined];
    void args;

    // Both rows now have emailed_at set.
    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, u.id));
    expect(rows.every((r) => r.emailedAt !== null)).toBe(true);
  });

  it("excludes rows past the retry cap", async () => {
    const u = await createUser();
    createdUserIds.add(u.id);
    const [seeded] = await db
      .insert(notifications)
      .values({
        userId: u.id,
        kind: "mention",
        payload: { fromName: "X", noteTitle: "T" },
        createdAt: new Date(Date.now() - 60_000),
        emailAttempts: 3,
        lastEmailError: "previous",
      })
      .returning({ id: notifications.id });
    createdNotifIds.add(seeded.id);

    const result = await runTestDispatcherTick();
    expect(result.instantSent).toBe(0);
    expect(sendMock).not.toHaveBeenCalled();

    // Row stays in pending state — emailedAt still null, attempts unchanged.
    const [row] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.id, seeded.id));
    expect(row.emailedAt).toBeNull();
    expect(row.emailAttempts).toBe(3);
  });
});

describe("runDispatcherTick lock", () => {
  // The dispatcher uses a transaction-scoped advisory lock. Cross-process
  // exclusion is still the production guarantee; this regression test covers
  // the local leak case by proving the next tick can acquire immediately.
  it("releases the advisory lock after each tick", async () => {
    const a = await runTestDispatcherTick();
    const b = await runTestDispatcherTick();
    expect(a.lockAcquired).toBe(true);
    expect(b.lockAcquired).toBe(true);
  });
});

// Sanity — keeps the isNull import alive (used as a marker for the
// `WHERE emailed_at IS NULL` semantics asserted via seeded data).
void isNull;
