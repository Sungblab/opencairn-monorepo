CREATE TABLE "site_admin_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reporter_user_id" text,
	"type" text DEFAULT 'bug' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"page_url" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"resolved_by_user_id" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_admin_reports_reporter_user_id_user_id_fk" FOREIGN KEY ("reporter_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action,
	CONSTRAINT "site_admin_reports_resolved_by_user_id_user_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action,
	CONSTRAINT "site_admin_reports_type_check" CHECK ("type" IN ('bug', 'feedback', 'billing', 'security', 'other')),
	CONSTRAINT "site_admin_reports_priority_check" CHECK ("priority" IN ('low', 'normal', 'high', 'urgent')),
	CONSTRAINT "site_admin_reports_status_check" CHECK ("status" IN ('open', 'triaged', 'resolved', 'closed'))
);
--> statement-breakpoint
CREATE INDEX "site_admin_reports_status_created_idx" ON "site_admin_reports" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "site_admin_reports_reporter_idx" ON "site_admin_reports" USING btree ("reporter_user_id","created_at");
