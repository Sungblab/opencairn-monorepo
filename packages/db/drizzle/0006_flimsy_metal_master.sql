CREATE TABLE "project_semaphore_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"holder_id" text NOT NULL,
	"purpose" text NOT NULL,
	"acquired_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_semaphore_slots" ADD CONSTRAINT "project_semaphore_slots_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_semaphore_slots_project_idx" ON "project_semaphore_slots" USING btree ("project_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "project_semaphore_slots_holder_idx" ON "project_semaphore_slots" USING btree ("project_id","holder_id");--> statement-breakpoint

-- Plan 4 Task 4 — keep notes.content_tsv populated for BM25 hybrid search.
-- `simple` config lowercases + splits on whitespace/punct without stemming,
-- which works across Korean / English / Japanese / Chinese. English stemming
-- would need a per-locale column pair; we deliberately trade recall for
-- language coverage since the corpus is always mixed.
CREATE OR REPLACE FUNCTION notes_content_tsv_update() RETURNS trigger AS $$
BEGIN
  NEW.content_tsv := to_tsvector(
    'simple',
    coalesce(NEW.title, '') || ' ' || coalesce(NEW.content_text, '')
  );
  RETURN NEW;
END
$$ LANGUAGE plpgsql;--> statement-breakpoint

DROP TRIGGER IF EXISTS notes_content_tsv_trigger ON "notes";--> statement-breakpoint

CREATE TRIGGER notes_content_tsv_trigger
  BEFORE INSERT OR UPDATE OF title, content_text
  ON "notes"
  FOR EACH ROW EXECUTE FUNCTION notes_content_tsv_update();--> statement-breakpoint

-- Backfill existing rows so hybrid search can match historical notes.
UPDATE "notes"
SET content_tsv = to_tsvector(
  'simple',
  coalesce(title, '') || ' ' || coalesce(content_text, '')
)
WHERE content_tsv IS NULL;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "notes_content_tsv_idx" ON "notes" USING GIN ("content_tsv");