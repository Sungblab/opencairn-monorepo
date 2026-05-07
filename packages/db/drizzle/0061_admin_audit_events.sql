CREATE TABLE "admin_audit_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "actor_user_id" text,
  "action" text NOT NULL,
  "target_user_id" text,
  "target_workspace_id" uuid,
  "target_report_id" uuid,
  "target_type" text NOT NULL,
  "target_id" text NOT NULL,
  "before" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "after" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "admin_audit_events_actor_user_id_user_id_fk"
    FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id")
    ON DELETE set null ON UPDATE no action,
  CONSTRAINT "admin_audit_events_target_user_id_user_id_fk"
    FOREIGN KEY ("target_user_id") REFERENCES "public"."user"("id")
    ON DELETE set null ON UPDATE no action,
  CONSTRAINT "admin_audit_events_target_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("target_workspace_id") REFERENCES "public"."workspaces"("id")
    ON DELETE set null ON UPDATE no action,
  CONSTRAINT "admin_audit_events_target_report_id_site_admin_reports_id_fk"
    FOREIGN KEY ("target_report_id") REFERENCES "public"."site_admin_reports"("id")
    ON DELETE set null ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX "admin_audit_events_created_idx" ON "admin_audit_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "admin_audit_events_actor_created_idx" ON "admin_audit_events" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "admin_audit_events_action_created_idx" ON "admin_audit_events" USING btree ("action","created_at");--> statement-breakpoint
CREATE INDEX "admin_audit_events_target_user_created_idx" ON "admin_audit_events" USING btree ("target_user_id","created_at");--> statement-breakpoint
CREATE INDEX "admin_audit_events_target_workspace_created_idx" ON "admin_audit_events" USING btree ("target_workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "admin_audit_events_target_report_created_idx" ON "admin_audit_events" USING btree ("target_report_id","created_at");
