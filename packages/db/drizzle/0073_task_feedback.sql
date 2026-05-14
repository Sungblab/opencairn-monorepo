CREATE TABLE "task_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"artifact_id" uuid,
	"rating" text NOT NULL,
	"reason" text,
	"comment" text,
	"follow_up_intent" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_feedback_target_user_unique" UNIQUE("target_type","target_id","user_id"),
	CONSTRAINT "task_feedback_target_type_check" CHECK ("task_feedback"."target_type" IN ('chat_run','workflow_run','agent_action','agent_file','document_generation')),
	CONSTRAINT "task_feedback_rating_check" CHECK ("task_feedback"."rating" IN ('useful','not_useful','skipped'))
);
--> statement-breakpoint
ALTER TABLE "task_feedback" ADD CONSTRAINT "task_feedback_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "task_feedback" ADD CONSTRAINT "task_feedback_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "task_feedback" ADD CONSTRAINT "task_feedback_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "task_feedback_project_created_idx" ON "task_feedback" USING btree ("project_id","created_at");
--> statement-breakpoint
CREATE INDEX "task_feedback_artifact_idx" ON "task_feedback" USING btree ("artifact_id");
