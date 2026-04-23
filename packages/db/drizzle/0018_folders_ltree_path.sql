-- App Shell Phase 2 — add ltree path column to folders (ADR 009).
--
-- folders.path is a materialized path encoding the folder ancestry using the
-- folder's own UUID (dashes replaced by underscores, since ltree labels only
-- accept [A-Za-z0-9_]). With a GiST index on path, sidebar subtree queries
-- run in O(log n) via `path <@ ancestor`.
--
-- notes are intentionally NOT given a path column — they stay as flat leaves
-- under their folder_id and move via a single-row UPDATE. Only the folder
-- dimension of the tree is hierarchical. See ADR 009 §Decision / §Context.

-- 1) Ensure ltree extension. Idempotent so re-running the migration (or
--    migrating a fresh environment that never had it) is safe.
CREATE EXTENSION IF NOT EXISTS ltree;--> statement-breakpoint

-- 2) Add the column as nullable so existing rows can be backfilled before
--    the NOT NULL constraint bites.
ALTER TABLE "folders" ADD COLUMN "path" ltree;--> statement-breakpoint

-- 3) Backfill. Each root folder's path is its own id (dashes → underscores);
--    each child's path is its parent's path plus its own label. The recursive
--    CTE walks parent→child and converges because folders.parent_id is a DAG
--    rooted at NULL within each project.
WITH RECURSIVE walk AS (
  SELECT
    f.id,
    f.parent_id,
    f.project_id,
    (regexp_replace(f.id::text, '-', '_', 'g'))::ltree AS new_path
  FROM "folders" f
  WHERE f.parent_id IS NULL
  UNION ALL
  SELECT
    c.id,
    c.parent_id,
    c.project_id,
    (w.new_path || regexp_replace(c.id::text, '-', '_', 'g'))::ltree
  FROM "folders" c
  JOIN walk w ON c.parent_id = w.id AND c.project_id = w.project_id
)
UPDATE "folders" f
SET "path" = w.new_path
FROM walk w
WHERE f.id = w.id;--> statement-breakpoint

-- 4) Fail loud if any row was missed (orphaned folder with a dangling
--    parent_id). An orphan should never exist due to the FK, but a mid-
--    migration failure is safer than a silent NULL.
DO $$
DECLARE null_count int;
BEGIN
  SELECT COUNT(*) INTO null_count FROM "folders" WHERE "path" IS NULL;
  IF null_count > 0 THEN
    RAISE EXCEPTION 'folders ltree backfill left % NULL rows', null_count;
  END IF;
END$$;--> statement-breakpoint

-- 5) Enforce NOT NULL + create the GiST index. Index comes last so the
--    backfill doesn't pay index-maintenance cost.
ALTER TABLE "folders" ALTER COLUMN "path" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "folders_path_gist" ON "folders" USING GIST ("path");
