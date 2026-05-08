CREATE EXTENSION IF NOT EXISTS ltree;
--> statement-breakpoint
CREATE TYPE "project_tree_node_kind" AS ENUM (
  'folder',
  'note',
  'agent_file',
  'code_workspace',
  'source_bundle',
  'artifact_group',
  'artifact'
);
--> statement-breakpoint
CREATE TYPE "project_tree_target_table" AS ENUM (
  'folders',
  'notes',
  'agent_files',
  'code_workspaces'
);
--> statement-breakpoint
CREATE TABLE "project_tree_nodes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "parent_id" uuid,
  "kind" "project_tree_node_kind" NOT NULL,
  "target_table" "project_tree_target_table",
  "target_id" uuid,
  "label" text NOT NULL,
  "icon" text,
  "position" integer DEFAULT 0 NOT NULL,
  "path" ltree NOT NULL,
  "source_workflow_id" text,
  "source_object_key" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  CONSTRAINT "project_tree_nodes_target_pair_check"
    CHECK (("target_table" IS NULL AND "target_id" IS NULL) OR ("target_table" IS NOT NULL AND "target_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "project_tree_nodes"
  ADD CONSTRAINT "project_tree_nodes_workspace_id_workspaces_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "project_tree_nodes"
  ADD CONSTRAINT "project_tree_nodes_project_id_projects_id_fk"
  FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "project_tree_nodes"
  ADD CONSTRAINT "project_tree_nodes_parent_id_project_tree_nodes_id_fk"
  FOREIGN KEY ("parent_id") REFERENCES "public"."project_tree_nodes"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "project_tree_nodes_project_parent_idx"
  ON "project_tree_nodes" USING btree ("project_id","parent_id","position","created_at");
--> statement-breakpoint
CREATE INDEX "project_tree_nodes_project_kind_idx"
  ON "project_tree_nodes" USING btree ("project_id","kind");
--> statement-breakpoint
CREATE INDEX "project_tree_nodes_source_workflow_idx"
  ON "project_tree_nodes" USING btree ("source_workflow_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "project_tree_nodes_target_unique_idx"
  ON "project_tree_nodes" USING btree ("target_table","target_id")
  WHERE "project_tree_nodes"."target_table" IS NOT NULL AND "project_tree_nodes"."target_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "project_tree_nodes_path_gist_idx"
  ON "project_tree_nodes" USING gist ("path");
--> statement-breakpoint
INSERT INTO project_tree_nodes (
  id, workspace_id, project_id, parent_id, kind, target_table, target_id,
  label, icon, position, path, metadata, created_at, updated_at, deleted_at
)
SELECT
  f.id,
  p.workspace_id,
  f.project_id,
  f.parent_id,
  'folder',
  'folders',
  f.id,
  f.name,
  'folder',
  f.position,
  f.path,
  '{}'::jsonb,
  f.created_at,
  f.updated_at,
  NULL
FROM folders f
JOIN projects p ON p.id = f.project_id
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO project_tree_nodes (
  id, workspace_id, project_id, parent_id, kind, target_table, target_id,
  label, icon, position, path, metadata, created_at, updated_at, deleted_at
)
SELECT
  n.id,
  n.workspace_id,
  n.project_id,
  n.folder_id,
  'note',
  'notes',
  n.id,
  n.title,
  'file-text',
  0,
  CASE
    WHEN n.folder_id IS NULL THEN replace(n.id::text, '-', '_')::ltree
    ELSE parent.path || replace(n.id::text, '-', '_')::ltree
  END,
  jsonb_build_object('sourceType', n.source_type, 'noteType', n.type),
  n.created_at,
  n.updated_at,
  n.deleted_at
FROM notes n
LEFT JOIN folders parent ON parent.id = n.folder_id
WHERE n.deleted_at IS NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO project_tree_nodes (
  id, workspace_id, project_id, parent_id, kind, target_table, target_id,
  label, icon, position, path, source_workflow_id, source_object_key,
  metadata, created_at, updated_at, deleted_at
)
SELECT
  af.id,
  af.workspace_id,
  af.project_id,
  af.folder_id,
  'agent_file',
  'agent_files',
  af.id,
  af.title,
  CASE
    WHEN af.mime_type = 'application/pdf' THEN 'file-pdf'
    WHEN af.kind = 'image' THEN 'image'
    ELSE 'file'
  END,
  0,
  CASE
    WHEN af.folder_id IS NULL THEN replace(af.id::text, '-', '_')::ltree
    ELSE parent.path || replace(af.id::text, '-', '_')::ltree
  END,
  af.ingest_workflow_id,
  af.object_key,
  jsonb_build_object('fileKind', af.kind, 'mimeType', af.mime_type, 'filename', af.filename),
  af.created_at,
  af.updated_at,
  af.deleted_at
FROM agent_files af
LEFT JOIN folders parent ON parent.id = af.folder_id
WHERE af.deleted_at IS NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO project_tree_nodes (
  id, workspace_id, project_id, parent_id, kind, target_table, target_id,
  label, icon, position, path, metadata, created_at, updated_at, deleted_at
)
SELECT
  cw.id,
  cw.workspace_id,
  cw.project_id,
  NULL,
  'code_workspace',
  'code_workspaces',
  cw.id,
  cw.name,
  'code',
  0,
  replace(cw.id::text, '-', '_')::ltree,
  jsonb_build_object('language', cw.language, 'framework', cw.framework),
  cw.created_at,
  cw.updated_at,
  cw.deleted_at
FROM code_workspaces cw
WHERE cw.deleted_at IS NULL
ON CONFLICT DO NOTHING;
