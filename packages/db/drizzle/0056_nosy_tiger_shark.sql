CREATE TYPE "public"."note_analysis_status" AS ENUM('queued', 'running', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "note_analysis_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"note_id" uuid NOT NULL,
	"content_hash" text NOT NULL,
	"yjs_state_vector" "bytea",
	"analysis_version" integer DEFAULT 1 NOT NULL,
	"status" "note_analysis_status" DEFAULT 'queued' NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"last_queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_started_at" timestamp with time zone,
	"last_completed_at" timestamp with time zone,
	"error_code" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "note_analysis_jobs" ADD CONSTRAINT "note_analysis_jobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_analysis_jobs" ADD CONSTRAINT "note_analysis_jobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_analysis_jobs" ADD CONSTRAINT "note_analysis_jobs_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "note_analysis_jobs_note_unique" ON "note_analysis_jobs" USING btree ("note_id");--> statement-breakpoint
CREATE INDEX "note_analysis_jobs_due_idx" ON "note_analysis_jobs" USING btree ("status","run_after");--> statement-breakpoint
CREATE INDEX "note_analysis_jobs_project_status_idx" ON "note_analysis_jobs" USING btree ("project_id","status","updated_at");--> statement-breakpoint
CREATE INDEX "note_analysis_jobs_workspace_status_idx" ON "note_analysis_jobs" USING btree ("workspace_id","status","updated_at");--> statement-breakpoint
CREATE INDEX "note_analysis_jobs_content_hash_idx" ON "note_analysis_jobs" USING btree ("content_hash");