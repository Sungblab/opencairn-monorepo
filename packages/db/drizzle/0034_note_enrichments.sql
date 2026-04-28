CREATE TABLE "note_enrichments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"note_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"content_type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"artifact" jsonb,
	"provider" text,
	"skip_reasons" text[],
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "note_enrichments" ADD CONSTRAINT "note_enrichments_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_enrichments" ADD CONSTRAINT "note_enrichments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "note_enrichments_note_id_idx" ON "note_enrichments" USING btree ("note_id");--> statement-breakpoint
CREATE INDEX "note_enrichments_workspace_id_idx" ON "note_enrichments" USING btree ("workspace_id");