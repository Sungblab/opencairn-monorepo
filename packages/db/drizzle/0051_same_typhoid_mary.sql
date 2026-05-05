CREATE TYPE "public"."code_workspace_entry_kind" AS ENUM('file', 'directory');--> statement-breakpoint
CREATE TYPE "public"."code_workspace_patch_status" AS ENUM('approval_required', 'applied', 'rejected');--> statement-breakpoint
CREATE TABLE "code_workspace_file_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"path" text NOT NULL,
	"path_key" text NOT NULL,
	"kind" "code_workspace_entry_kind" NOT NULL,
	"language" text,
	"mime_type" text,
	"bytes" bigint,
	"content_hash" text,
	"object_key" text,
	"inline_content" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "code_workspace_patches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"created_by" text NOT NULL,
	"code_workspace_id" uuid NOT NULL,
	"base_snapshot_id" uuid NOT NULL,
	"applied_snapshot_id" uuid,
	"status" "code_workspace_patch_status" DEFAULT 'approval_required' NOT NULL,
	"risk" "agent_action_risk" DEFAULT 'write' NOT NULL,
	"operations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"preview" jsonb NOT NULL,
	"action_id" uuid,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "code_workspace_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code_workspace_id" uuid NOT NULL,
	"parent_snapshot_id" uuid,
	"tree_hash" text NOT NULL,
	"manifest" jsonb NOT NULL,
	"source_action_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "code_workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"created_by" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"language" text,
	"framework" text,
	"current_snapshot_id" uuid,
	"source_run_id" text,
	"source_action_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "code_workspace_file_entries" ADD CONSTRAINT "code_workspace_file_entries_snapshot_id_code_workspace_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."code_workspace_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_workspace_patches" ADD CONSTRAINT "code_workspace_patches_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_workspace_patches" ADD CONSTRAINT "code_workspace_patches_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_workspace_patches" ADD CONSTRAINT "code_workspace_patches_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_workspace_patches" ADD CONSTRAINT "code_workspace_patches_code_workspace_id_code_workspaces_id_fk" FOREIGN KEY ("code_workspace_id") REFERENCES "public"."code_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_workspace_patches" ADD CONSTRAINT "code_workspace_patches_base_snapshot_id_code_workspace_snapshots_id_fk" FOREIGN KEY ("base_snapshot_id") REFERENCES "public"."code_workspace_snapshots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_workspace_patches" ADD CONSTRAINT "code_workspace_patches_applied_snapshot_id_code_workspace_snapshots_id_fk" FOREIGN KEY ("applied_snapshot_id") REFERENCES "public"."code_workspace_snapshots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_workspace_patches" ADD CONSTRAINT "code_workspace_patches_action_id_agent_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."agent_actions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_workspace_snapshots" ADD CONSTRAINT "code_workspace_snapshots_code_workspace_id_code_workspaces_id_fk" FOREIGN KEY ("code_workspace_id") REFERENCES "public"."code_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_workspace_snapshots" ADD CONSTRAINT "code_workspace_snapshots_parent_snapshot_id_code_workspace_snapshots_id_fk" FOREIGN KEY ("parent_snapshot_id") REFERENCES "public"."code_workspace_snapshots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_workspace_snapshots" ADD CONSTRAINT "code_workspace_snapshots_source_action_id_agent_actions_id_fk" FOREIGN KEY ("source_action_id") REFERENCES "public"."agent_actions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_workspaces" ADD CONSTRAINT "code_workspaces_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_workspaces" ADD CONSTRAINT "code_workspaces_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_workspaces" ADD CONSTRAINT "code_workspaces_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_workspaces" ADD CONSTRAINT "code_workspaces_source_action_id_agent_actions_id_fk" FOREIGN KEY ("source_action_id") REFERENCES "public"."agent_actions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "code_workspace_file_entries_path_unique" ON "code_workspace_file_entries" USING btree ("snapshot_id","path_key");--> statement-breakpoint
CREATE INDEX "code_workspace_file_entries_snapshot_kind_idx" ON "code_workspace_file_entries" USING btree ("snapshot_id","kind");--> statement-breakpoint
CREATE INDEX "code_workspace_file_entries_object_key_idx" ON "code_workspace_file_entries" USING btree ("object_key") WHERE "code_workspace_file_entries"."object_key" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "code_workspace_patches_request_unique" ON "code_workspace_patches" USING btree ("project_id","created_by","request_id");--> statement-breakpoint
CREATE INDEX "code_workspace_patches_workspace_status_idx" ON "code_workspace_patches" USING btree ("code_workspace_id","status","created_at");--> statement-breakpoint
CREATE INDEX "code_workspace_patches_action_idx" ON "code_workspace_patches" USING btree ("action_id") WHERE "code_workspace_patches"."action_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "code_workspace_snapshots_workspace_created_idx" ON "code_workspace_snapshots" USING btree ("code_workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "code_workspace_snapshots_tree_unique" ON "code_workspace_snapshots" USING btree ("code_workspace_id","tree_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "code_workspaces_request_unique" ON "code_workspaces" USING btree ("project_id","created_by","request_id");--> statement-breakpoint
CREATE INDEX "code_workspaces_project_live_idx" ON "code_workspaces" USING btree ("project_id","updated_at") WHERE "code_workspaces"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "code_workspaces_workspace_created_idx" ON "code_workspaces" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "code_workspaces_source_action_idx" ON "code_workspaces" USING btree ("source_action_id") WHERE "code_workspaces"."source_action_id" IS NOT NULL;