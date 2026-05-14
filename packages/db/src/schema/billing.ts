import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  creditBillingPathEnum,
  creditLedgerKindEnum,
  userPlanEnum,
} from "./enums";
import { user } from "./users";
import { workspaces } from "./workspaces";

export const creditBalances = pgTable(
  "credit_balances",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    plan: userPlanEnum("plan").notNull().default("free"),
    balanceCredits: bigint("balance_credits", { mode: "number" })
      .notNull()
      .default(0),
    monthlyGrantCredits: bigint("monthly_grant_credits", { mode: "number" })
      .notNull()
      .default(0),
    monthlyGrantAnchor: timestamp("monthly_grant_anchor", { withTimezone: true }),
    autoRechargeEnabled: boolean("auto_recharge_enabled").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index("credit_balances_plan_idx").on(t.plan)],
);

export const creditLedgerEntries = pgTable(
  "credit_ledger_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, {
      onDelete: "set null",
    }),
    kind: creditLedgerKindEnum("kind").notNull(),
    billingPath: creditBillingPathEnum("billing_path").notNull().default("managed"),
    deltaCredits: bigint("delta_credits", { mode: "number" }).notNull(),
    balanceAfterCredits: bigint("balance_after_credits", {
      mode: "number",
    }).notNull(),
    operation: text("operation"),
    provider: text("provider"),
    model: text("model"),
    pricingTier: text("pricing_tier"),
    tokensIn: bigint("tokens_in", { mode: "number" }).notNull().default(0),
    tokensOut: bigint("tokens_out", { mode: "number" }).notNull().default(0),
    cachedTokens: bigint("cached_tokens", { mode: "number" }).notNull().default(0),
    searchQueries: integer("search_queries").notNull().default(0),
    rawCostUsd: numeric("raw_cost_usd", { precision: 12, scale: 6 })
      .notNull()
      .default("0"),
    rawCostKrw: numeric("raw_cost_krw", { precision: 14, scale: 4 })
      .notNull()
      .default("0"),
    usdToKrw: numeric("usd_to_krw", { precision: 12, scale: 4 })
      .notNull()
      .default("1650"),
    marginMultiplier: numeric("margin_multiplier", { precision: 8, scale: 4 })
      .notNull()
      .default("1.6"),
    featureMultiplier: numeric("feature_multiplier", { precision: 8, scale: 4 })
      .notNull()
      .default("1"),
    sourceType: text("source_type"),
    sourceId: text("source_id"),
    requestId: text("request_id"),
    idempotencyKey: text("idempotency_key"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("credit_ledger_entries_user_created_idx").on(t.userId, t.createdAt),
    index("credit_ledger_entries_workspace_created_idx").on(
      t.workspaceId,
      t.createdAt,
    ),
    index("credit_ledger_entries_source_idx").on(t.sourceType, t.sourceId),
    index("credit_ledger_entries_request_idx").on(t.requestId),
    uniqueIndex("credit_ledger_entries_user_idempotency_key_idx")
      .on(t.userId, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} IS NOT NULL`),
  ],
);

export const adminCreditCampaigns = pgTable(
  "admin_credit_campaigns",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    code: text("code"),
    status: text("status").notNull().default("active"),
    creditAmount: bigint("credit_amount", { mode: "number" }).notNull(),
    targetPlan: userPlanEnum("target_plan"),
    maxRedemptions: integer("max_redemptions"),
    redeemedCount: integer("redeemed_count").notNull().default(0),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("admin_credit_campaigns_code_idx")
      .on(t.code)
      .where(sql`${t.code} IS NOT NULL`),
    index("admin_credit_campaigns_status_created_idx").on(t.status, t.createdAt),
    index("admin_credit_campaigns_target_plan_idx").on(t.targetPlan),
  ],
);

export type CreditBalance = typeof creditBalances.$inferSelect;
export type CreditBalanceInsert = typeof creditBalances.$inferInsert;
export type CreditLedgerEntry = typeof creditLedgerEntries.$inferSelect;
export type CreditLedgerEntryInsert = typeof creditLedgerEntries.$inferInsert;
export type AdminCreditCampaign = typeof adminCreditCampaigns.$inferSelect;
export type AdminCreditCampaignInsert = typeof adminCreditCampaigns.$inferInsert;
