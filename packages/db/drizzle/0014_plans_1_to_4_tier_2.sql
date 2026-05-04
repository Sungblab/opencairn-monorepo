-- Hardening bundle for invite indexes, slug constraints, and Yjs document
-- size limits.
--
-- Ordering matters for yjs_documents: the column must be added nullable,
-- backfilled from octet_length(state), then promoted to NOT NULL, otherwise
-- the migration would fail on any existing row.

-- 2-1/2-2: HNSW vector indexes. Without these, similarity queries against
-- notes.embedding / concepts.embedding fall back to a sequential scan that
-- gets dramatically slower as the row count grows. `vector_cosine_ops`
-- matches the cosine-distance
-- operators the hybrid-search path uses today. drizzle-kit cannot emit the
-- opclass through a customType column, so these two are hand-written here
-- and the snapshot records them as plain btree placeholders — the database
-- DDL is authoritative, and the schema file on notes/concepts is left alone
-- to avoid a customType-diff tug-of-war on every future generate.
CREATE INDEX "notes_embedding_hnsw_idx" ON "notes" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "concepts_embedding_hnsw_idx" ON "concepts" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint

-- 2-6: drop the duplicate btree — the `workspaces_slug_unique` constraint
-- from 0000 already creates its own unique btree on the same column.
DROP INDEX "workspaces_slug_idx";--> statement-breakpoint

-- 2-4: invited_by indexes. Audit joins and FK SET NULL cascades scan the
-- whole table without them.
CREATE INDEX "workspace_invites_invited_by_idx" ON "workspace_invites" USING btree ("invited_by");--> statement-breakpoint
CREATE INDEX "workspace_members_invited_by_idx" ON "workspace_members" USING btree ("invited_by");--> statement-breakpoint

-- 2-3: partial unique on pending invites. Forbids two open invites to the
-- same (workspace, email) pair while still allowing a re-invite after the
-- prior one is accepted (acceptedAt IS NOT NULL leaves the key outside the
-- uniqueness set).
CREATE UNIQUE INDEX "workspace_invites_ws_email_pending_idx" ON "workspace_invites" USING btree ("workspace_id","email") WHERE "workspace_invites"."accepted_at" IS NULL;--> statement-breakpoint

-- 2-5: slug must match lower(slug). Case-sensitive unique would let `Acme`
-- and `acme` both exist as routable slugs — trivial squatting primitive.
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_slug_lower_check" CHECK ("workspaces"."slug" = lower("workspaces"."slug"));--> statement-breakpoint

-- 2-7: yjs_documents size cap (4 MB). Three-step NOT NULL promotion so the
-- migration succeeds on tables with existing rows.
ALTER TABLE "yjs_documents" ADD COLUMN "size_bytes" integer;--> statement-breakpoint
UPDATE "yjs_documents" SET "size_bytes" = octet_length("state") WHERE "size_bytes" IS NULL;--> statement-breakpoint
ALTER TABLE "yjs_documents" ALTER COLUMN "size_bytes" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "yjs_documents" ADD CONSTRAINT "yjs_documents_state_size_check" CHECK (octet_length("yjs_documents"."state") <= 4194304);
