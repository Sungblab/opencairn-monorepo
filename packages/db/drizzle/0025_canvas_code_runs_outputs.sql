CREATE TABLE "canvas_outputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"note_id" uuid NOT NULL,
	"run_id" uuid,
	"content_hash" text NOT NULL,
	"mime_type" text NOT NULL,
	"s3_key" text NOT NULL,
	"bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "canvas_outputs_note_hash_unique" UNIQUE("note_id","content_hash")
);
--> statement-breakpoint
CREATE TABLE "code_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"note_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"prompt" text NOT NULL,
	"language" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"workflow_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "code_turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"kind" text NOT NULL,
	"source" text NOT NULL,
	"explanation" text,
	"prev_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "code_turns_run_seq_unique" UNIQUE("run_id","seq")
);
--> statement-breakpoint
ALTER TABLE "canvas_outputs" ADD CONSTRAINT "canvas_outputs_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_outputs" ADD CONSTRAINT "canvas_outputs_run_id_code_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."code_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_runs" ADD CONSTRAINT "code_runs_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_runs" ADD CONSTRAINT "code_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_runs" ADD CONSTRAINT "code_runs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_turns" ADD CONSTRAINT "code_turns_run_id_code_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."code_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "canvas_outputs_note_idx" ON "canvas_outputs" USING btree ("note_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "code_runs_note_idx" ON "code_runs" USING btree ("note_id","created_at" DESC NULLS LAST);