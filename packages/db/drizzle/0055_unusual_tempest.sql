ALTER TABLE "note_chunks" ADD COLUMN "context_text" text DEFAULT '' NOT NULL;--> statement-breakpoint

CREATE OR REPLACE FUNCTION note_chunks_content_tsv_update() RETURNS trigger AS $$
BEGIN
  NEW.content_tsv := to_tsvector(
    'simple',
    concat_ws(' ', NEW.context_text, NEW.heading_path, NEW.content_text)
  );
  RETURN NEW;
END
$$ LANGUAGE plpgsql;--> statement-breakpoint

UPDATE "note_chunks"
SET content_tsv = to_tsvector(
  'simple',
  concat_ws(' ', context_text, heading_path, content_text)
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "note_chunks_embedding_hnsw_idx"
ON "note_chunks" USING hnsw ("embedding" vector_cosine_ops);
