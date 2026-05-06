ALTER TABLE "agentic_plan_steps" ADD COLUMN "evidence_refs" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "agentic_plan_steps" ADD COLUMN "evidence_freshness_status" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "agentic_plan_steps" ADD COLUMN "stale_evidence_blocks" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "agentic_plan_steps" ADD COLUMN "verification_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "agentic_plan_steps" ADD COLUMN "recovery_code" text;--> statement-breakpoint
ALTER TABLE "agentic_plan_steps" ADD COLUMN "retry_count" integer DEFAULT 0 NOT NULL;