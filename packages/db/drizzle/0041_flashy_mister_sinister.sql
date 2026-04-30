CREATE TYPE "public"."note_version_actor_type" AS ENUM('user', 'agent', 'system');--> statement-breakpoint
CREATE TYPE "public"."note_version_source" AS ENUM('auto_save', 'title_change', 'ai_edit', 'restore', 'manual_checkpoint', 'import');--> statement-breakpoint
CREATE TABLE "note_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"note_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"content" jsonb NOT NULL,
	"content_text" text DEFAULT '' NOT NULL,
	"content_hash" text NOT NULL,
	"yjs_state" "bytea",
	"yjs_state_vector" "bytea",
	"actor_id" text,
	"actor_type" "note_version_actor_type" DEFAULT 'user' NOT NULL,
	"source" "note_version_source" NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "note_versions" ADD CONSTRAINT "note_versions_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_versions" ADD CONSTRAINT "note_versions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_versions" ADD CONSTRAINT "note_versions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_versions" ADD CONSTRAINT "note_versions_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "note_versions_note_version_idx" ON "note_versions" USING btree ("note_id","version");--> statement-breakpoint
CREATE INDEX "note_versions_note_created_idx" ON "note_versions" USING btree ("note_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "note_versions_workspace_created_idx" ON "note_versions" USING btree ("workspace_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "note_versions_actor_created_idx" ON "note_versions" USING btree ("actor_id","created_at" DESC NULLS LAST);