import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  creditBalances,
  creditLedgerEntries,
  db,
  eq,
  user,
} from "@opencairn/db";
import {
  chargeManagedCredits,
  getCreditBalance,
  grantCredits,
  InsufficientCreditsError,
} from "./billing";

const userIds: string[] = [];

async function createTestUser() {
  const id = `billing-test-${crypto.randomUUID()}`;
  userIds.push(id);
  await db.insert(user).values({
    id,
    email: `${id}@example.test`,
    name: "Billing Test User",
  });
  return id;
}

describe("billing credits", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    for (const id of userIds.splice(0)) {
      await db.delete(user).where(eq(user.id, id));
    }
  });

  it("grants credits and deducts managed Gemini usage through the ledger", async () => {
    const userId = await createTestUser();
    await grantCredits({
      userId,
      credits: 10_000,
      kind: "subscription_grant",
      plan: "pro",
      idempotencyKey: `${userId}:grant`,
    });

    const result = await chargeManagedCredits({
      userId,
      provider: "gemini",
      model: "gemini-3-flash-preview",
      operation: "chat",
      tokensIn: 1_000_000,
      tokensOut: 1_000_000,
      idempotencyKey: `${userId}:usage`,
    });

    expect(result.cost.costUsd).toBe(3.5);
    expect(result.cost.billableCredits).toBe(9_240);
    expect(result.ledgerEntry.deltaCredits).toBe(-9_240);
    expect(result.ledgerEntry.balanceAfterCredits).toBe(760);
    expect(result.ledgerEntry.marginMultiplier).toBe("1.6000");
    expect(result.balance.balanceCredits).toBe(760);
  });

  it("keeps managed usage idempotent by idempotency key", async () => {
    const userId = await createTestUser();
    await grantCredits({ userId, credits: 10_000 });

    const first = await chargeManagedCredits({
      userId,
      provider: "gemini",
      model: "gemini-3-flash-preview",
      operation: "chat",
      tokensIn: 1_000_000,
      tokensOut: 0,
      idempotencyKey: `${userId}:repeat`,
    });
    const second = await chargeManagedCredits({
      userId,
      provider: "gemini",
      model: "gemini-3-flash-preview",
      operation: "chat",
      tokensIn: 1_000_000,
      tokensOut: 0,
      idempotencyKey: `${userId}:repeat`,
    });

    const balance = await getCreditBalance(userId);
    const entries = await db
      .select()
      .from(creditLedgerEntries)
      .where(eq(creditLedgerEntries.idempotencyKey, `${userId}:repeat`));

    expect(first.ledgerEntry.id).toBe(second.ledgerEntry.id);
    expect(entries).toHaveLength(1);
    expect(balance.balanceCredits).toBe(8_680);
  });

  it("rejects managed usage when the balance cannot cover the charge", async () => {
    const userId = await createTestUser();

    await expect(
      chargeManagedCredits({
        userId,
        provider: "gemini",
        model: "gemini-3-flash-preview",
        operation: "chat",
        tokensIn: 1_000_000,
        tokensOut: 1_000_000,
      }),
    ).rejects.toBeInstanceOf(InsufficientCreditsError);

    const [balance] = await db
      .select()
      .from(creditBalances)
      .where(eq(creditBalances.userId, userId));
    expect(balance).toBeUndefined();
  });

  it("snapshots adjusted margin on each usage transaction", async () => {
    vi.stubEnv("LLM_COST_MARGIN_MULTIPLIER", "2");
    const userId = await createTestUser();
    await grantCredits({ userId, credits: 10_000 });

    const result = await chargeManagedCredits({
      userId,
      provider: "gemini",
      model: "gemini-3-flash-preview",
      operation: "chat",
      tokensIn: 1_000_000,
      tokensOut: 0,
    });

    expect(result.cost.costKrw).toBe(825);
    expect(result.cost.billableCredits).toBe(1_650);
    expect(result.ledgerEntry.rawCostKrw).toBe("825.0000");
    expect(result.ledgerEntry.marginMultiplier).toBe("2.0000");
    expect(result.balance.balanceCredits).toBe(8_350);
  });
});
