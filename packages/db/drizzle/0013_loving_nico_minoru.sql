CREATE TYPE "public"."research_artifact_kind" AS ENUM('thought_summary', 'text_delta', 'image', 'citation');--> statement-breakpoint
CREATE TYPE "public"."research_billing_path" AS ENUM('byok', 'managed');--> statement-breakpoint
CREATE TYPE "public"."research_model" AS ENUM('deep-research-preview-04-2026', 'deep-research-max-preview-04-2026');--> statement-breakpoint
CREATE TYPE "public"."research_status" AS ENUM('planning', 'awaiting_approval', 'researching', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."research_turn_kind" AS ENUM('plan_proposal', 'user_feedback', 'user_edit', 'approval');--> statement-breakpoint
CREATE TYPE "public"."research_turn_role" AS ENUM('system', 'user', 'agent');--> statement-breakpoint
CREATE TABLE "research_run_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"kind" "research_artifact_kind" NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_run_turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"role" "research_turn_role" NOT NULL,
	"kind" "research_turn_kind" NOT NULL,
	"interaction_id" text,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"topic" text NOT NULL,
	"model" "research_model" NOT NULL,
	"billing_path" "research_billing_path" NOT NULL,
	"status" "research_status" DEFAULT 'planning' NOT NULL,
	"current_interaction_id" text,
	"approved_plan_text" text,
	"workflow_id" text NOT NULL,
	"note_id" uuid,
	"error" jsonb,
	"total_cost_usd_cents" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "byok_api_key_encrypted" "bytea";--> statement-breakpoint
ALTER TABLE "research_run_artifacts" ADD CONSTRAINT "research_run_artifacts_run_id_research_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."research_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_run_turns" ADD CONSTRAINT "research_run_turns_run_id_research_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."research_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_runs" ADD CONSTRAINT "research_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_runs" ADD CONSTRAINT "research_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_runs" ADD CONSTRAINT "research_runs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_runs" ADD CONSTRAINT "research_runs_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "research_run_artifacts_run_seq_idx" ON "research_run_artifacts" USING btree ("run_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "research_run_turns_run_seq_idx" ON "research_run_turns" USING btree ("run_id","seq");--> statement-breakpoint
CREATE INDEX "research_runs_workspace_status_idx" ON "research_runs" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "research_runs_user_created_idx" ON "research_runs" USING btree ("user_id","created_at");