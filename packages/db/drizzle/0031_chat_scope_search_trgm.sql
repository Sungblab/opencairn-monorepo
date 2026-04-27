-- Plan 11A code-review follow-up — pg_trgm-backed GIN indexes for the
-- /api/search/scope-targets chip combobox. Without these the leading-
-- wildcard `ilike` in apps/api/src/routes/search.ts falls back to a
-- sequential scan on notes/projects, which is fine at small scale but
-- degrades fast past ~10k rows.
--
-- Migration number is 0031 (not 0030) because the parallel session warned
-- that 0030 was reserved at the time this branch was opened. CREATE
-- EXTENSION requires superuser; in dev the `opencairn` user is
-- superuser, in prod this should run during a maintenance window.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notes_title_trgm_idx" ON "notes" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "projects_name_trgm_idx" ON "projects" USING gin ("name" gin_trgm_ops);
