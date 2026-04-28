-- Plan: Literature Search & Auto-Import (2026-04-27).
-- Adds DOI dedupe column on notes + new enum values for the literature
-- federation pipeline. Migration number 0033 (plan doc says 0029; stale —
-- 0030/0032 already shipped, 0034 is reserved by content-aware-enrichment
-- session running in parallel).

ALTER TYPE "public"."import_source" ADD VALUE 'literature_search';--> statement-breakpoint
ALTER TYPE "public"."source_type" ADD VALUE 'paper';--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "doi" text;--> statement-breakpoint
-- Partial unique: at most one note per (workspace, doi). Notes without a
-- DOI (the vast majority) skip the index. Mirrors the schema-level
-- uniqueIndex(...).where(doi IS NOT NULL) declaration in notes.ts.
CREATE UNIQUE INDEX "notes_workspace_doi_idx"
  ON "notes" ("workspace_id", "doi")
  WHERE "doi" IS NOT NULL;
