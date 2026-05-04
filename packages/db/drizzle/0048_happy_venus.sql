ALTER TABLE "chat_run_events" ADD COLUMN "execution_attempt" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_runs" ADD COLUMN "current_attempt" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_runs" ADD COLUMN "execution_lease_id" text;--> statement-breakpoint
ALTER TABLE "chat_runs" ADD COLUMN "execution_lease_expires_at" timestamp with time zone;