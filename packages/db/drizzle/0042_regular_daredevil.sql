CREATE TABLE "note_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"note_id" uuid NOT NULL,
	"chunk_index" integer NOT NULL,
	"heading_path" text DEFAULT '' NOT NULL,
	"content_text" text NOT NULL,
	"content_tsv" "tsvector" DEFAULT ''::tsvector NOT NULL,
	"embedding" vector(768),
	"token_count" integer NOT NULL,
	"source_offsets" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "note_chunks" ADD CONSTRAINT "note_chunks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_chunks" ADD CONSTRAINT "note_chunks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_chunks" ADD CONSTRAINT "note_chunks_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "note_chunks_note_index_unique" ON "note_chunks" USING btree ("note_id","chunk_index");--> statement-breakpoint
CREATE INDEX "note_chunks_content_hash_idx" ON "note_chunks" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "note_chunks_active_project_idx" ON "note_chunks" USING btree ("project_id","deleted_at");--> statement-breakpoint
CREATE INDEX "note_chunks_active_workspace_idx" ON "note_chunks" USING btree ("workspace_id","deleted_at");--> statement-breakpoint
CREATE INDEX "note_chunks_content_tsv_idx" ON "note_chunks" USING gin ("content_tsv");
--> statement-breakpoint

-- Keep chunk BM25 input populated from MIME-agnostic content_text.
CREATE OR REPLACE FUNCTION note_chunks_content_tsv_update() RETURNS trigger AS $$
BEGIN
  NEW.content_tsv := to_tsvector('simple', coalesce(NEW.content_text, ''));
  RETURN NEW;
END
$$ LANGUAGE plpgsql;--> statement-breakpoint

DROP TRIGGER IF EXISTS note_chunks_content_tsv_trigger ON "note_chunks";--> statement-breakpoint

CREATE TRIGGER note_chunks_content_tsv_trigger
  BEFORE INSERT OR UPDATE OF content_text
  ON "note_chunks"
  FOR EACH ROW EXECUTE FUNCTION note_chunks_content_tsv_update();--> statement-breakpoint

-- Denormalize parent note soft-delete state so retrieval can filter chunks
-- before joining notes.
CREATE OR REPLACE FUNCTION note_chunks_note_deleted_at_sync() RETURNS trigger AS $$
BEGIN
  UPDATE "note_chunks"
  SET deleted_at = NEW.deleted_at,
      updated_at = now()
  WHERE note_id = NEW.id
    AND deleted_at IS DISTINCT FROM NEW.deleted_at;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;--> statement-breakpoint

DROP TRIGGER IF EXISTS note_chunks_note_deleted_at_trigger ON "notes";--> statement-breakpoint

CREATE TRIGGER note_chunks_note_deleted_at_trigger
  AFTER UPDATE OF deleted_at
  ON "notes"
  FOR EACH ROW EXECUTE FUNCTION note_chunks_note_deleted_at_sync();
