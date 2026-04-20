-- Embedding model switch: gemini-embedding-2-preview (3072d) → gemini-embedding-001 (768d Matryoshka)
-- ADR-007, 2026-04-21. Dev-only data is dropped; callers must re-run ingest
-- workflows to repopulate embeddings after this migration.

UPDATE "concepts" SET "embedding" = NULL;--> statement-breakpoint
UPDATE "notes" SET "embedding" = NULL;--> statement-breakpoint
ALTER TABLE "concepts" ALTER COLUMN "embedding" SET DATA TYPE vector(768);--> statement-breakpoint
ALTER TABLE "notes" ALTER COLUMN "embedding" SET DATA TYPE vector(768);
