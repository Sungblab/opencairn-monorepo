-- App Shell Phase 1 — track each user's most recent workspace so the root
-- redirect can land them in the same place across devices.
--
-- The FK is added separately: workspaces already references user(id), so we
-- can't put .references() on this column inline (Drizzle's TS-side circular
-- import would fail). The constraint is enforced in SQL all the same.
ALTER TABLE "user" ADD COLUMN "last_viewed_workspace_id" uuid;
--> statement-breakpoint
ALTER TABLE "user"
  ADD CONSTRAINT "user_last_viewed_workspace_id_workspaces_id_fk"
  FOREIGN KEY ("last_viewed_workspace_id") REFERENCES "workspaces"("id")
  ON DELETE SET NULL;
