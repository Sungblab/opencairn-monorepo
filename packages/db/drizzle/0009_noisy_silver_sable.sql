CREATE TYPE "public"."embedding_batch_state" AS ENUM('pending', 'running', 'succeeded', 'failed', 'cancelled', 'expired', 'timeout');--> statement-breakpoint
CREATE TABLE "embedding_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"provider" text NOT NULL,
	"provider_batch_name" text NOT NULL,
	"state" "embedding_batch_state" DEFAULT 'pending' NOT NULL,
	"input_count" integer NOT NULL,
	"success_count" integer DEFAULT 0 NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"pending_count" integer DEFAULT 0 NOT NULL,
	"input_s3_key" text NOT NULL,
	"output_s3_key" text,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"submitted_at" timestamp,
	"completed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "embedding_batches" ADD CONSTRAINT "embedding_batches_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "embedding_batches_state_created_idx" ON "embedding_batches" USING btree ("state","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "embedding_batches_provider_name_idx" ON "embedding_batches" USING btree ("provider_batch_name");