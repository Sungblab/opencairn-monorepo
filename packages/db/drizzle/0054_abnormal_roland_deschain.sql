CREATE TYPE "public"."agentic_plan_status" AS ENUM('draft', 'approval_required', 'queued', 'running', 'blocked', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."agentic_plan_step_kind" AS ENUM('note.review_update', 'document.generate', 'file.export', 'code.run', 'code.repair', 'import.retry', 'agent.run', 'manual.review');--> statement-breakpoint
CREATE TYPE "public"."agentic_plan_step_status" AS ENUM('draft', 'approval_required', 'queued', 'running', 'blocked', 'completed', 'failed', 'cancelled', 'skipped');--> statement-breakpoint
CREATE TABLE "agentic_plan_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"kind" "agentic_plan_step_kind" NOT NULL,
	"title" text NOT NULL,
	"rationale" text NOT NULL,
	"status" "agentic_plan_step_status" DEFAULT 'approval_required' NOT NULL,
	"risk" "agent_action_risk" DEFAULT 'low' NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"linked_run_type" text,
	"linked_run_id" text,
	"error_code" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agentic_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"actor_user_id" text NOT NULL,
	"title" text NOT NULL,
	"goal" text NOT NULL,
	"status" "agentic_plan_status" DEFAULT 'approval_required' NOT NULL,
	"target" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"planner_kind" text DEFAULT 'deterministic' NOT NULL,
	"summary" text NOT NULL,
	"current_step_ordinal" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "agentic_plan_steps" ADD CONSTRAINT "agentic_plan_steps_plan_id_agentic_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."agentic_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agentic_plans" ADD CONSTRAINT "agentic_plans_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agentic_plans" ADD CONSTRAINT "agentic_plans_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agentic_plans" ADD CONSTRAINT "agentic_plans_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agentic_plan_steps_plan_ordinal_idx" ON "agentic_plan_steps" USING btree ("plan_id","ordinal");--> statement-breakpoint
CREATE INDEX "agentic_plan_steps_plan_status_idx" ON "agentic_plan_steps" USING btree ("plan_id","status");--> statement-breakpoint
CREATE INDEX "agentic_plan_steps_linked_run_idx" ON "agentic_plan_steps" USING btree ("linked_run_type","linked_run_id") WHERE "agentic_plan_steps"."linked_run_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "agentic_plans_project_status_idx" ON "agentic_plans" USING btree ("project_id","status","updated_at");--> statement-breakpoint
CREATE INDEX "agentic_plans_workspace_created_idx" ON "agentic_plans" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "agentic_plans_goal_search_idx" ON "agentic_plans" USING gin (to_tsvector('simple', "title" || ' ' || "goal"));