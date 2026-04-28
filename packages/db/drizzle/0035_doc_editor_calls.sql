CREATE TABLE "doc_editor_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"note_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"command" text NOT NULL,
	"tokens_in" integer DEFAULT 0 NOT NULL,
	"tokens_out" integer DEFAULT 0 NOT NULL,
	"cost_krw" numeric(12, 4) DEFAULT '0' NOT NULL,
	"status" text NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doc_editor_calls_status_check" CHECK ("doc_editor_calls"."status" IN ('ok', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "doc_editor_calls" ADD CONSTRAINT "doc_editor_calls_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_editor_calls" ADD CONSTRAINT "doc_editor_calls_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_editor_calls" ADD CONSTRAINT "doc_editor_calls_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "doc_editor_calls_user_recent_idx" ON "doc_editor_calls" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "doc_editor_calls_note_recent_idx" ON "doc_editor_calls" USING btree ("note_id","created_at");
