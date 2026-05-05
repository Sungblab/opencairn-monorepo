CREATE TABLE "agent_file_provider_exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"agent_file_id" uuid NOT NULL,
	"action_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"status" text NOT NULL,
	"workflow_id" text,
	"external_object_id" text,
	"external_url" text,
	"exported_mime_type" text,
	"error_code" text,
	"retryable" boolean DEFAULT false NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_file_provider_exports_action_unique" UNIQUE("action_id")
);
--> statement-breakpoint
ALTER TABLE "agent_file_provider_exports" ADD CONSTRAINT "agent_file_provider_exports_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_file_provider_exports" ADD CONSTRAINT "agent_file_provider_exports_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_file_provider_exports" ADD CONSTRAINT "agent_file_provider_exports_agent_file_id_agent_files_id_fk" FOREIGN KEY ("agent_file_id") REFERENCES "public"."agent_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_file_provider_exports" ADD CONSTRAINT "agent_file_provider_exports_action_id_agent_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."agent_actions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_file_provider_exports" ADD CONSTRAINT "agent_file_provider_exports_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_file_provider_exports_file_created_idx" ON "agent_file_provider_exports" USING btree ("agent_file_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_file_provider_exports_project_created_idx" ON "agent_file_provider_exports" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_file_provider_exports_external_idx" ON "agent_file_provider_exports" USING btree ("provider","external_object_id");