CREATE TYPE "public"."suggestion_status" AS ENUM('pending', 'accepted', 'rejected', 'expired');--> statement-breakpoint
CREATE TYPE "public"."suggestion_type" AS ENUM('connector_link', 'curator_orphan', 'curator_duplicate', 'curator_contradiction', 'curator_external_source', 'synthesis_insight');--> statement-breakpoint
CREATE TABLE "audio_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"note_id" uuid,
	"r2_key" text NOT NULL,
	"duration_sec" integer,
	"voices" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stale_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"note_id" uuid NOT NULL,
	"staleness_score" real NOT NULL,
	"reason" text NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"project_id" uuid,
	"type" "suggestion_type" NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "suggestion_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "audio_files" ADD CONSTRAINT "audio_files_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stale_alerts" ADD CONSTRAINT "stale_alerts_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audio_files_note_idx" ON "audio_files" USING btree ("note_id");--> statement-breakpoint
CREATE INDEX "stale_alerts_note_idx" ON "stale_alerts" USING btree ("note_id");--> statement-breakpoint
CREATE INDEX "suggestions_user_status_idx" ON "suggestions" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "suggestions_project_type_idx" ON "suggestions" USING btree ("project_id","type");