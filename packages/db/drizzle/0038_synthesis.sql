CREATE TABLE "synthesis_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"format" text NOT NULL,
	"s3_key" text,
	"bytes" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "synthesis_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid,
	"user_id" text NOT NULL,
	"format" text NOT NULL,
	"template" text NOT NULL,
	"user_prompt" text NOT NULL,
	"auto_search" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"workflow_id" text,
	"tokens_used" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "synthesis_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"title" text,
	"token_count" integer,
	"included" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "synthesis_documents" ADD CONSTRAINT "synthesis_documents_run_id_synthesis_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."synthesis_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "synthesis_runs" ADD CONSTRAINT "synthesis_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "synthesis_runs" ADD CONSTRAINT "synthesis_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "synthesis_runs" ADD CONSTRAINT "synthesis_runs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "synthesis_sources" ADD CONSTRAINT "synthesis_sources_run_id_synthesis_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."synthesis_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "synthesis_runs_workspace_idx" ON "synthesis_runs" USING btree ("workspace_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "synthesis_runs_user_idx" ON "synthesis_runs" USING btree ("user_id","created_at" DESC NULLS LAST);