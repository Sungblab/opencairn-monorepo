CREATE TABLE "wiki_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_note_id" uuid NOT NULL,
	"target_note_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "wiki_links_source_target_unique" UNIQUE("source_note_id","target_note_id")
);
--> statement-breakpoint
ALTER TABLE "wiki_links" ADD CONSTRAINT "wiki_links_source_note_id_notes_id_fk" FOREIGN KEY ("source_note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_links" ADD CONSTRAINT "wiki_links_target_note_id_notes_id_fk" FOREIGN KEY ("target_note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_links" ADD CONSTRAINT "wiki_links_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wiki_links_target_idx" ON "wiki_links" USING btree ("target_note_id");--> statement-breakpoint
CREATE INDEX "wiki_links_workspace_idx" ON "wiki_links" USING btree ("workspace_id");
--> statement-breakpoint
-- Plan 5 Phase 1 backfill: extract existing wiki-link nodes from notes.content.
-- Plate node shape: { type: 'wiki-link', targetId: '<uuid>', title: '<str>', children: [...] }
-- jsonb_path_query (PG 12+) recursively walks JSON; '$.** ? (@.type == "wiki-link")'
-- yields every wiki-link node at any depth. Validate targetId is a UUID AND
-- points to an existing, non-soft-deleted note before insert.
INSERT INTO "wiki_links" ("source_note_id", "target_note_id", "workspace_id")
SELECT DISTINCT
  n.id AS source_note_id,
  (link->>'targetId')::uuid AS target_note_id,
  p.workspace_id
FROM "notes" n
JOIN "projects" p ON p.id = n.project_id
JOIN LATERAL jsonb_path_query(n.content, '$.** ? (@.type == "wiki-link")') AS link
  ON true
WHERE n.deleted_at IS NULL
  AND n.content IS NOT NULL
  AND link ? 'targetId'
  AND (link->>'targetId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND EXISTS (
    SELECT 1 FROM "notes" t
    WHERE t.id = (link->>'targetId')::uuid
      AND t.deleted_at IS NULL
  )
ON CONFLICT ("source_note_id", "target_note_id") DO NOTHING;