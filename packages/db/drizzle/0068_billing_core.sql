ALTER TYPE "user_plan" ADD VALUE IF NOT EXISTS 'max';
--> statement-breakpoint
CREATE TYPE "credit_ledger_kind" AS ENUM (
  'subscription_grant',
  'topup',
  'usage',
  'refund',
  'adjustment',
  'manual_grant'
);
--> statement-breakpoint
CREATE TYPE "credit_billing_path" AS ENUM (
  'managed',
  'byok',
  'admin'
);
--> statement-breakpoint
CREATE TABLE "credit_balances" (
  "user_id" text PRIMARY KEY NOT NULL,
  "plan" "user_plan" DEFAULT 'free' NOT NULL,
  "balance_credits" bigint DEFAULT 0 NOT NULL,
  "monthly_grant_credits" bigint DEFAULT 0 NOT NULL,
  "monthly_grant_anchor" timestamp with time zone,
  "auto_recharge_enabled" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "credit_balances"
  ADD CONSTRAINT "credit_balances_user_id_user_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."user"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "credit_balances_plan_idx"
  ON "credit_balances" USING btree ("plan");
--> statement-breakpoint
CREATE TABLE "credit_ledger_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "workspace_id" uuid,
  "kind" "credit_ledger_kind" NOT NULL,
  "billing_path" "credit_billing_path" DEFAULT 'managed' NOT NULL,
  "delta_credits" bigint NOT NULL,
  "balance_after_credits" bigint NOT NULL,
  "operation" text,
  "provider" text,
  "model" text,
  "pricing_tier" text,
  "tokens_in" bigint DEFAULT 0 NOT NULL,
  "tokens_out" bigint DEFAULT 0 NOT NULL,
  "cached_tokens" bigint DEFAULT 0 NOT NULL,
  "search_queries" integer DEFAULT 0 NOT NULL,
  "raw_cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
  "raw_cost_krw" numeric(14, 4) DEFAULT '0' NOT NULL,
  "usd_to_krw" numeric(12, 4) DEFAULT '1650' NOT NULL,
  "margin_multiplier" numeric(8, 4) DEFAULT '1.6' NOT NULL,
  "feature_multiplier" numeric(8, 4) DEFAULT '1' NOT NULL,
  "source_type" text,
  "source_id" text,
  "request_id" text,
  "idempotency_key" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "expires_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "credit_ledger_entries"
  ADD CONSTRAINT "credit_ledger_entries_user_id_user_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."user"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "credit_ledger_entries"
  ADD CONSTRAINT "credit_ledger_entries_workspace_id_workspaces_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id")
  ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "credit_ledger_entries_user_created_idx"
  ON "credit_ledger_entries" USING btree ("user_id","created_at");
--> statement-breakpoint
CREATE INDEX "credit_ledger_entries_workspace_created_idx"
  ON "credit_ledger_entries" USING btree ("workspace_id","created_at");
--> statement-breakpoint
CREATE INDEX "credit_ledger_entries_source_idx"
  ON "credit_ledger_entries" USING btree ("source_type","source_id");
--> statement-breakpoint
CREATE INDEX "credit_ledger_entries_request_idx"
  ON "credit_ledger_entries" USING btree ("request_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "credit_ledger_entries_idempotency_key_idx"
  ON "credit_ledger_entries" USING btree ("idempotency_key")
  WHERE "credit_ledger_entries"."idempotency_key" IS NOT NULL;
