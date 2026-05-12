import {
  creditBalances,
  creditLedgerEntries,
  and,
  db,
  eq,
  sql,
  type CreditBalance,
  type CreditLedgerEntry,
  type DB,
  type Tx,
} from "@opencairn/db";
import {
  estimateTokenCost,
  type PricingTier,
  type TokenCostEstimate,
} from "./cost";

type DbConn = DB | Tx;
type UserPlan = "free" | "pro" | "max" | "byok";
type CreditLedgerKind =
  | "subscription_grant"
  | "topup"
  | "usage"
  | "refund"
  | "adjustment"
  | "manual_grant";

export class InsufficientCreditsError extends Error {
  constructor(
    public readonly userId: string,
    public readonly requiredCredits: number,
  ) {
    super("insufficient_credits");
  }
}

export type CreditBalanceView = {
  userId: string;
  plan: UserPlan;
  balanceCredits: number;
  monthlyGrantCredits: number;
  autoRechargeEnabled: boolean;
  updatedAt: Date;
};

export type CreditLedgerSource = {
  workspaceId?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  requestId?: string | null;
  idempotencyKey?: string | null;
  metadata?: Record<string, unknown>;
};

export type CreditLedgerResult = {
  balance: CreditBalanceView;
  ledgerEntry: CreditLedgerEntry;
};

export type GrantCreditsInput = CreditLedgerSource & {
  userId: string;
  credits: number;
  kind?: "subscription_grant" | "topup" | "refund" | "adjustment" | "manual_grant";
  plan?: UserPlan;
  expiresAt?: Date | null;
};

export type ChargeManagedCreditsInput = CreditLedgerSource & {
  userId: string;
  provider: string;
  model: string;
  operation: string;
  pricingTier?: PricingTier;
  tokensIn: number;
  tokensOut: number;
  cachedTokens?: number;
  searchQueries?: number;
  featureMultiplier?: number;
};

export type ChargeManagedCreditsResult = CreditLedgerResult & {
  cost: TokenCostEstimate;
};

function toBalanceView(row: CreditBalance): CreditBalanceView {
  return {
    userId: row.userId,
    plan: row.plan,
    balanceCredits: row.balanceCredits,
    monthlyGrantCredits: row.monthlyGrantCredits,
    autoRechargeEnabled: row.autoRechargeEnabled,
    updatedAt: row.updatedAt,
  };
}

function normaliseCredits(credits: number): number {
  return Math.max(0, Math.trunc(credits));
}

async function findLedgerByIdempotencyKey(
  conn: DbConn,
  userId: string,
  idempotencyKey: string | null | undefined,
): Promise<CreditLedgerEntry | null> {
  if (!idempotencyKey) return null;
  const [entry] = await conn
    .select()
    .from(creditLedgerEntries)
    .where(
      and(
        eq(creditLedgerEntries.userId, userId),
        eq(creditLedgerEntries.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);
  return entry ?? null;
}

async function ensureCreditBalance(
  conn: DbConn,
  input: {
    userId: string;
    plan?: UserPlan;
    monthlyGrantCredits?: number;
  },
): Promise<CreditBalance> {
  const now = new Date();
  await conn
    .insert(creditBalances)
    .values({
      userId: input.userId,
      plan: input.plan ?? "free",
      monthlyGrantCredits: input.monthlyGrantCredits ?? 0,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();

  const [balance] = await conn
    .select()
    .from(creditBalances)
    .where(eq(creditBalances.userId, input.userId))
    .limit(1);

  if (!balance) {
    throw new Error("credit_balance_create_failed");
  }
  return balance;
}

export async function getCreditBalance(
  userId: string,
  conn: DbConn = db,
): Promise<CreditBalanceView> {
  const balance = await ensureCreditBalance(conn, { userId });
  return toBalanceView(balance);
}

async function applyCreditDelta(
  conn: DbConn,
  input: {
    userId: string;
    deltaCredits: number;
    kind: CreditLedgerKind;
    billingPath: "managed" | "byok" | "admin";
    plan?: UserPlan;
    monthlyGrantCredits?: number;
    provider?: string | null;
    model?: string | null;
    operation?: string | null;
    pricingTier?: string | null;
    tokensIn?: number;
    tokensOut?: number;
    cachedTokens?: number;
    searchQueries?: number;
    rawCostUsd?: number;
    rawCostKrw?: number;
    usdToKrw?: number;
    marginMultiplier?: number;
    featureMultiplier?: number;
    expiresAt?: Date | null;
  } & CreditLedgerSource,
): Promise<CreditLedgerResult> {
  const existing = await findLedgerByIdempotencyKey(conn, input.userId, input.idempotencyKey);
  if (existing) {
    return {
      balance: await getCreditBalance(input.userId, conn),
      ledgerEntry: existing,
    };
  }

  await ensureCreditBalance(conn, {
    userId: input.userId,
    plan: input.plan,
    monthlyGrantCredits: input.monthlyGrantCredits,
  });

  const deltaCredits = Math.trunc(input.deltaCredits);
  const now = new Date();
  const setValues: {
    balanceCredits: ReturnType<typeof sql>;
    plan?: UserPlan;
    monthlyGrantCredits?: number;
    updatedAt: Date;
  } = {
    balanceCredits: sql`${creditBalances.balanceCredits} + ${deltaCredits}`,
    updatedAt: now,
  };
  if (input.plan) setValues.plan = input.plan;
  if (input.monthlyGrantCredits !== undefined) {
    setValues.monthlyGrantCredits = input.monthlyGrantCredits;
  }

  const [updated] =
    deltaCredits < 0
      ? await conn
          .update(creditBalances)
          .set(setValues)
          .where(
            sql`${creditBalances.userId} = ${input.userId} AND ${creditBalances.balanceCredits} >= ${Math.abs(deltaCredits)}`,
          )
          .returning()
      : await conn
          .update(creditBalances)
          .set(setValues)
          .where(eq(creditBalances.userId, input.userId))
          .returning();

  if (!updated) {
    throw new InsufficientCreditsError(input.userId, Math.abs(deltaCredits));
  }

  const [ledgerEntry] = await conn
    .insert(creditLedgerEntries)
    .values({
      userId: input.userId,
      workspaceId: input.workspaceId ?? null,
      kind: input.kind,
      billingPath: input.billingPath,
      deltaCredits,
      balanceAfterCredits: updated.balanceCredits,
      operation: input.operation ?? null,
      provider: input.provider ?? null,
      model: input.model ?? null,
      pricingTier: input.pricingTier ?? null,
      tokensIn: input.tokensIn ?? 0,
      tokensOut: input.tokensOut ?? 0,
      cachedTokens: input.cachedTokens ?? 0,
      searchQueries: input.searchQueries ?? 0,
      rawCostUsd: (input.rawCostUsd ?? 0).toFixed(6),
      rawCostKrw: (input.rawCostKrw ?? 0).toFixed(4),
      usdToKrw: (input.usdToKrw ?? 1650).toFixed(4),
      marginMultiplier: (input.marginMultiplier ?? 1).toFixed(4),
      featureMultiplier: (input.featureMultiplier ?? 1).toFixed(4),
      sourceType: input.sourceType ?? null,
      sourceId: input.sourceId ?? null,
      requestId: input.requestId ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      metadata: input.metadata ?? {},
      expiresAt: input.expiresAt ?? null,
    })
    .returning();

  if (!ledgerEntry) {
    throw new Error("credit_ledger_insert_failed");
  }

  return {
    balance: toBalanceView(updated),
    ledgerEntry,
  };
}

export async function grantCredits(
  input: GrantCreditsInput,
): Promise<CreditLedgerResult> {
  const credits = normaliseCredits(input.credits);
  return db.transaction((tx) =>
    applyCreditDelta(tx, {
      ...input,
      deltaCredits: credits,
      kind: input.kind ?? "manual_grant",
      billingPath: input.kind === "topup" ? "managed" : "admin",
      monthlyGrantCredits:
        input.kind === "subscription_grant" ? credits : undefined,
    }),
  );
}

export async function chargeManagedCredits(
  input: ChargeManagedCreditsInput,
): Promise<ChargeManagedCreditsResult> {
  const cost = estimateTokenCost(input);
  const result = await db.transaction((tx) =>
    applyCreditDelta(tx, {
      ...input,
      deltaCredits: -cost.billableCredits,
      kind: "usage",
      billingPath: "managed",
      pricingTier: cost.pricingTier,
      tokensIn: cost.tokensIn,
      tokensOut: cost.tokensOut,
      cachedTokens: cost.cachedTokens,
      searchQueries: cost.searchQueries,
      rawCostUsd: cost.costUsd,
      rawCostKrw: cost.costKrw,
      usdToKrw: cost.usdToKrw,
      marginMultiplier: cost.marginMultiplier,
      featureMultiplier: cost.featureMultiplier,
    }),
  );
  return { ...result, cost };
}
