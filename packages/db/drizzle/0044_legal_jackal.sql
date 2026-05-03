CREATE TABLE "agent_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"folder_id" uuid,
	"created_by" text NOT NULL,
	"title" text NOT NULL,
	"filename" text NOT NULL,
	"extension" text NOT NULL,
	"kind" text NOT NULL,
	"mime_type" text NOT NULL,
	"object_key" text NOT NULL,
	"bytes" integer NOT NULL,
	"content_hash" text NOT NULL,
	"source" text DEFAULT 'agent_chat' NOT NULL,
	"chat_thread_id" uuid,
	"chat_message_id" uuid,
	"parent_file_id" uuid,
	"version_group_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"ingest_workflow_id" text,
	"ingest_status" text DEFAULT 'not_started' NOT NULL,
	"source_note_id" uuid,
	"canvas_note_id" uuid,
	"compile_status" text DEFAULT 'not_started' NOT NULL,
	"compiled_object_key" text,
	"compiled_mime_type" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "agent_files" ADD CONSTRAINT "agent_files_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_files" ADD CONSTRAINT "agent_files_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_files" ADD CONSTRAINT "agent_files_folder_id_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_files" ADD CONSTRAINT "agent_files_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_files" ADD CONSTRAINT "agent_files_parent_file_id_agent_files_id_fk" FOREIGN KEY ("parent_file_id") REFERENCES "public"."agent_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_files" ADD CONSTRAINT "agent_files_source_note_id_notes_id_fk" FOREIGN KEY ("source_note_id") REFERENCES "public"."notes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_files" ADD CONSTRAINT "agent_files_canvas_note_id_notes_id_fk" FOREIGN KEY ("canvas_note_id") REFERENCES "public"."notes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_files_project_folder_deleted_idx" ON "agent_files" USING btree ("project_id","folder_id","deleted_at");--> statement-breakpoint
CREATE INDEX "agent_files_workspace_created_idx" ON "agent_files" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_files_version_group_version_idx" ON "agent_files" USING btree ("version_group_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_files_object_key_idx" ON "agent_files" USING btree ("object_key");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_files_version_unique_idx" ON "agent_files" USING btree ("version_group_id","version");--> statement-breakpoint
CREATE INDEX "agent_files_live_project_idx" ON "agent_files" USING btree ("project_id") WHERE "agent_files"."deleted_at" IS NULL;