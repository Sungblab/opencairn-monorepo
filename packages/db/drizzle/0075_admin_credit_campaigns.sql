ALTER TYPE "admin_audit_action" ADD VALUE IF NOT EXISTS 'credit.manual_grant';
ALTER TYPE "admin_audit_action" ADD VALUE IF NOT EXISTS 'credit.campaign.create';
ALTER TYPE "admin_audit_action" ADD VALUE IF NOT EXISTS 'credit.campaign.update';
ALTER TYPE "admin_audit_action" ADD VALUE IF NOT EXISTS 'credit.campaign.grant';

CREATE TABLE IF NOT EXISTS "admin_credit_campaigns" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "code" text,
  "status" text DEFAULT 'active' NOT NULL,
  "credit_amount" bigint NOT NULL,
  "target_plan" "user_plan",
  "max_redemptions" integer,
  "redeemed_count" integer DEFAULT 0 NOT NULL,
  "starts_at" timestamp with time zone,
  "ends_at" timestamp with time zone,
  "created_by_user_id" text REFERENCES "user"("id") ON DELETE set null,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "admin_credit_campaigns_status_check"
    CHECK ("status" IN ('active', 'paused', 'archived')),
  CONSTRAINT "admin_credit_campaigns_credit_amount_check"
    CHECK ("credit_amount" > 0),
  CONSTRAINT "admin_credit_campaigns_max_redemptions_check"
    CHECK ("max_redemptions" IS NULL OR "max_redemptions" > 0),
  CONSTRAINT "admin_credit_campaigns_redeemed_count_check"
    CHECK ("redeemed_count" >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "admin_credit_campaigns_code_idx"
  ON "admin_credit_campaigns" ("code")
  WHERE "code" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "admin_credit_campaigns_status_created_idx"
  ON "admin_credit_campaigns" ("status", "created_at");

CREATE INDEX IF NOT EXISTS "admin_credit_campaigns_target_plan_idx"
  ON "admin_credit_campaigns" ("target_plan");
