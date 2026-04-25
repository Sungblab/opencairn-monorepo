CREATE TYPE "canvas_language" AS ENUM ('python', 'javascript', 'html', 'react');

ALTER TABLE "notes" ADD COLUMN "canvas_language" "canvas_language";

-- The CHECK uses `source_type::text = 'canvas'` rather than `source_type = 'canvas'`
-- because drizzle-orm's migrator wraps the whole migration batch in a single
-- transaction, and Postgres rejects direct use of an enum value added in the
-- same transaction (`unsafe use of new value` 55P04). The text cast bypasses
-- that check while preserving identical runtime semantics. Splitting the enum
-- ADD VALUE into its own migration file (0021) is still kept for clarity, but
-- the transaction-boundary fix is the cast — not the split.
--
-- Strict iff: canvas_language IS NOT NULL ↔ source_type = 'canvas'. The
-- second branch enforces that non-canvas notes (sourceType NULL or
-- non-canvas) MUST have canvas_language NULL — without this, a row with
-- sourceType='manual' AND canvas_language='python' would slip through.
-- API surface (PATCH /:id/canvas) already 409s on non-canvas writes, but
-- the DB CHECK is the defense-in-depth guarantee.
ALTER TABLE "notes" ADD CONSTRAINT "notes_canvas_language_check"
  CHECK (
    (source_type::text = 'canvas' AND canvas_language IS NOT NULL)
    OR ((source_type IS NULL OR source_type::text <> 'canvas') AND canvas_language IS NULL)
  );
