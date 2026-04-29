CREATE TYPE "public"."connector_account_status" AS ENUM('active', 'disabled', 'auth_expired', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."connector_auth_type" AS ENUM('oauth', 'pat', 'static_header', 'none');--> statement-breakpoint
CREATE TYPE "public"."connector_external_object_type" AS ENUM('file', 'folder', 'page', 'database', 'repo', 'issue', 'pull_request', 'comment', 'action_run', 'code_file', 'mcp_result');--> statement-breakpoint
CREATE TYPE "public"."connector_job_type" AS ENUM('import', 'sync', 'refresh_tools', 'preview');--> statement-breakpoint
CREATE TYPE "public"."connector_provider" AS ENUM('google_drive', 'github', 'notion', 'mcp_custom');--> statement-breakpoint
CREATE TYPE "public"."connector_risk_level" AS ENUM('safe_read', 'import', 'write', 'destructive', 'external_send', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."connector_source_kind" AS ENUM('drive_folder', 'drive_file', 'github_repo', 'notion_workspace', 'notion_page_tree', 'mcp_server');--> statement-breakpoint
CREATE TYPE "public"."connector_source_status" AS ENUM('active', 'disabled', 'auth_expired', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."connector_sync_mode" AS ENUM('one_shot', 'manual_resync', 'scheduled');--> statement-breakpoint
CREATE TABLE "connector_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"provider" "connector_provider" NOT NULL,
	"auth_type" "connector_auth_type" NOT NULL,
	"account_label" text NOT NULL,
	"account_email" text,
	"external_account_id" text,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	"access_token_encrypted" "bytea",
	"refresh_token_encrypted" "bytea",
	"token_expires_at" timestamp with time zone,
	"status" "connector_account_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connector_accounts_user_provider_external_unique" UNIQUE("user_id","provider","external_account_id")
);
--> statement-breakpoint
CREATE TABLE "connector_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"account_id" uuid,
	"source_id" uuid,
	"connector_job_id" uuid,
	"action" text NOT NULL,
	"risk_level" "connector_risk_level" NOT NULL,
	"provider" "connector_provider" NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connector_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"source_id" uuid,
	"job_type" "connector_job_type" NOT NULL,
	"workflow_id" text NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"total_items" integer DEFAULT 0 NOT NULL,
	"completed_items" integer DEFAULT 0 NOT NULL,
	"failed_items" integer DEFAULT 0 NOT NULL,
	"skipped_items" integer DEFAULT 0 NOT NULL,
	"source_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error_summary" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connector_jobs_workflow_id_unique" UNIQUE("workflow_id")
);
--> statement-breakpoint
CREATE TABLE "connector_mcp_tools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"tool_name" text NOT NULL,
	"description" text,
	"input_schema" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"risk_level" "connector_risk_level" NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connector_mcp_tools_source_tool_unique" UNIQUE("source_id","tool_name")
);
--> statement-breakpoint
CREATE TABLE "connector_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid,
	"account_id" uuid NOT NULL,
	"provider" "connector_provider" NOT NULL,
	"source_kind" "connector_source_kind" NOT NULL,
	"external_id" text NOT NULL,
	"display_name" text NOT NULL,
	"sync_mode" "connector_sync_mode" DEFAULT 'one_shot' NOT NULL,
	"permissions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "connector_source_status" DEFAULT 'active' NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connector_sources_workspace_account_source_unique" UNIQUE("workspace_id","account_id","source_kind","external_id")
);
--> statement-breakpoint
CREATE TABLE "external_object_refs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provider" "connector_provider" NOT NULL,
	"source_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"external_url" text,
	"object_type" "connector_external_object_type" NOT NULL,
	"external_version" text,
	"note_id" uuid,
	"concept_id" uuid,
	"concept_edge_id" uuid,
	"connector_job_id" uuid,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "external_object_refs_source_external_unique" UNIQUE("source_id","external_id","object_type")
);
--> statement-breakpoint
ALTER TABLE "connector_accounts" ADD CONSTRAINT "connector_accounts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_audit_events" ADD CONSTRAINT "connector_audit_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_audit_events" ADD CONSTRAINT "connector_audit_events_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_audit_events" ADD CONSTRAINT "connector_audit_events_account_id_connector_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."connector_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_audit_events" ADD CONSTRAINT "connector_audit_events_source_id_connector_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."connector_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_audit_events" ADD CONSTRAINT "connector_audit_events_connector_job_id_connector_jobs_id_fk" FOREIGN KEY ("connector_job_id") REFERENCES "public"."connector_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_jobs" ADD CONSTRAINT "connector_jobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_jobs" ADD CONSTRAINT "connector_jobs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_jobs" ADD CONSTRAINT "connector_jobs_source_id_connector_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."connector_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_mcp_tools" ADD CONSTRAINT "connector_mcp_tools_source_id_connector_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."connector_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_sources" ADD CONSTRAINT "connector_sources_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_sources" ADD CONSTRAINT "connector_sources_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_sources" ADD CONSTRAINT "connector_sources_account_id_connector_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."connector_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_sources" ADD CONSTRAINT "connector_sources_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_object_refs" ADD CONSTRAINT "external_object_refs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_object_refs" ADD CONSTRAINT "external_object_refs_source_id_connector_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."connector_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_object_refs" ADD CONSTRAINT "external_object_refs_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_object_refs" ADD CONSTRAINT "external_object_refs_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_object_refs" ADD CONSTRAINT "external_object_refs_concept_edge_id_concept_edges_id_fk" FOREIGN KEY ("concept_edge_id") REFERENCES "public"."concept_edges"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_object_refs" ADD CONSTRAINT "external_object_refs_connector_job_id_connector_jobs_id_fk" FOREIGN KEY ("connector_job_id") REFERENCES "public"."connector_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "connector_accounts_user_idx" ON "connector_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "connector_audit_events_workspace_created_idx" ON "connector_audit_events" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "connector_audit_events_source_idx" ON "connector_audit_events" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "connector_jobs_workspace_created_idx" ON "connector_jobs" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "connector_jobs_source_idx" ON "connector_jobs" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "connector_mcp_tools_source_idx" ON "connector_mcp_tools" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "connector_sources_workspace_idx" ON "connector_sources" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "connector_sources_project_idx" ON "connector_sources" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "external_object_refs_workspace_idx" ON "external_object_refs" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "external_object_refs_note_idx" ON "external_object_refs" USING btree ("note_id");--> statement-breakpoint
CREATE INDEX "external_object_refs_concept_idx" ON "external_object_refs" USING btree ("concept_id");