CREATE TYPE "public"."study_session_status" AS ENUM('active', 'processing', 'ready', 'archived');--> statement-breakpoint
CREATE TYPE "public"."study_session_source_role" AS ENUM('primary_pdf', 'reference', 'recording_note', 'generated_note');--> statement-breakpoint
CREATE TYPE "public"."session_recording_status" AS ENUM('uploaded', 'processing', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."transcript_status" AS ENUM('pending', 'processing', 'ready', 'failed');--> statement-breakpoint
CREATE TABLE "study_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"status" "study_session_status" DEFAULT 'active' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now(),
	"ended_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "study_session_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"note_id" uuid NOT NULL,
	"role" "study_session_source_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_recordings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"object_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"duration_sec" double precision,
	"status" "session_recording_status" DEFAULT 'uploaded' NOT NULL,
	"transcript_status" "transcript_status" DEFAULT 'pending' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transcript_segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recording_id" uuid NOT NULL,
	"segment_index" integer NOT NULL,
	"start_sec" double precision NOT NULL,
	"end_sec" double precision NOT NULL,
	"text" text NOT NULL,
	"speaker" text,
	"language" text,
	"confidence" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "study_sessions" ADD CONSTRAINT "study_sessions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_sessions" ADD CONSTRAINT "study_sessions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_sessions" ADD CONSTRAINT "study_sessions_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_session_sources" ADD CONSTRAINT "study_session_sources_session_id_study_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."study_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_session_sources" ADD CONSTRAINT "study_session_sources_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_recordings" ADD CONSTRAINT "session_recordings_session_id_study_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."study_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_recordings" ADD CONSTRAINT "session_recordings_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcript_segments" ADD CONSTRAINT "transcript_segments_recording_id_session_recordings_id_fk" FOREIGN KEY ("recording_id") REFERENCES "public"."session_recordings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "study_sessions_project_status_idx" ON "study_sessions" USING btree ("project_id","status","updated_at");--> statement-breakpoint
CREATE INDEX "study_sessions_workspace_created_idx" ON "study_sessions" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "study_session_sources_note_idx" ON "study_session_sources" USING btree ("note_id");--> statement-breakpoint
CREATE UNIQUE INDEX "study_session_sources_session_note_role_idx" ON "study_session_sources" USING btree ("session_id","note_id","role");--> statement-breakpoint
CREATE INDEX "session_recordings_session_status_idx" ON "session_recordings" USING btree ("session_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "transcript_segments_recording_index_idx" ON "transcript_segments" USING btree ("recording_id","segment_index");--> statement-breakpoint
CREATE INDEX "transcript_segments_recording_time_idx" ON "transcript_segments" USING btree ("recording_id","start_sec","end_sec");
