CREATE TYPE "public"."agent_action_kind" AS ENUM('workflow.placeholder', 'note.create', 'note.update', 'note.rename', 'note.move', 'note.delete', 'note.restore', 'note.comment', 'file.create', 'file.update', 'file.delete', 'file.compile', 'file.generate', 'file.export', 'import.upload', 'import.markdown_zip', 'import.drive', 'import.notion', 'import.literature', 'import.web', 'export.note', 'export.project', 'export.file', 'export.workspace', 'export.provider', 'code_project.create', 'code_project.patch', 'code_project.rename', 'code_project.delete', 'code_project.install', 'code_project.run', 'code_project.package');--> statement-breakpoint
CREATE TYPE "public"."agent_action_risk" AS ENUM('low', 'write', 'destructive', 'external', 'expensive');--> statement-breakpoint
CREATE TYPE "public"."agent_action_status" AS ENUM('draft', 'approval_required', 'queued', 'running', 'completed', 'failed', 'cancelled', 'reverted');--> statement-breakpoint
CREATE TABLE "agent_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"actor_user_id" text NOT NULL,
	"source_run_id" text,
	"kind" "agent_action_kind" NOT NULL,
	"status" "agent_action_status" DEFAULT 'draft' NOT NULL,
	"risk" "agent_action_risk" NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"preview" jsonb,
	"result" jsonb,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_actions" ADD CONSTRAINT "agent_actions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_actions" ADD CONSTRAINT "agent_actions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_actions" ADD CONSTRAINT "agent_actions_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_actions_request_id_idx" ON "agent_actions" USING btree ("project_id","actor_user_id","request_id");--> statement-breakpoint
CREATE INDEX "agent_actions_project_status_idx" ON "agent_actions" USING btree ("project_id","status","created_at");--> statement-breakpoint
CREATE INDEX "agent_actions_workspace_created_idx" ON "agent_actions" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_actions_source_run_idx" ON "agent_actions" USING btree ("source_run_id") WHERE "agent_actions"."source_run_id" IS NOT NULL;