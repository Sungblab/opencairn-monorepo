CREATE TABLE "concept_edge_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"concept_edge_id" uuid NOT NULL,
	"claim_id" uuid,
	"evidence_bundle_id" uuid NOT NULL,
	"note_chunk_id" uuid NOT NULL,
	"support_score" real NOT NULL,
	"stance" text NOT NULL,
	"quote" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "concept_extraction_chunks" (
	"extraction_id" uuid NOT NULL,
	"note_chunk_id" uuid NOT NULL,
	"support_score" real NOT NULL,
	"quote" text NOT NULL,
	CONSTRAINT "concept_extraction_chunks_extraction_id_note_chunk_id_pk" PRIMARY KEY("extraction_id","note_chunk_id")
);
--> statement-breakpoint
CREATE TABLE "concept_extractions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"concept_id" uuid,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"normalized_name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"confidence" real NOT NULL,
	"evidence_bundle_id" uuid NOT NULL,
	"source_note_id" uuid,
	"created_by_run_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence_bundle_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bundle_id" uuid NOT NULL,
	"note_chunk_id" uuid NOT NULL,
	"note_id" uuid NOT NULL,
	"rank" integer NOT NULL,
	"score" real NOT NULL,
	"retrieval_channel" text NOT NULL,
	"heading_path" text DEFAULT '' NOT NULL,
	"source_offsets" jsonb NOT NULL,
	"quote" text NOT NULL,
	"citation" jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence_bundles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"producer_kind" text NOT NULL,
	"producer_run_id" text,
	"model" text,
	"tool" text,
	"query" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"claim_text" text NOT NULL,
	"claim_type" text NOT NULL,
	"subject_concept_id" uuid,
	"object_concept_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"confidence" real NOT NULL,
	"evidence_bundle_id" uuid NOT NULL,
	"produced_by" text NOT NULL,
	"produced_by_run_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "concept_edge_evidence" ADD CONSTRAINT "concept_edge_evidence_concept_edge_id_concept_edges_id_fk" FOREIGN KEY ("concept_edge_id") REFERENCES "public"."concept_edges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_edge_evidence" ADD CONSTRAINT "concept_edge_evidence_claim_id_knowledge_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."knowledge_claims"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_edge_evidence" ADD CONSTRAINT "concept_edge_evidence_evidence_bundle_id_evidence_bundles_id_fk" FOREIGN KEY ("evidence_bundle_id") REFERENCES "public"."evidence_bundles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_edge_evidence" ADD CONSTRAINT "concept_edge_evidence_note_chunk_id_note_chunks_id_fk" FOREIGN KEY ("note_chunk_id") REFERENCES "public"."note_chunks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_extraction_chunks" ADD CONSTRAINT "concept_extraction_chunks_extraction_id_concept_extractions_id_fk" FOREIGN KEY ("extraction_id") REFERENCES "public"."concept_extractions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_extraction_chunks" ADD CONSTRAINT "concept_extraction_chunks_note_chunk_id_note_chunks_id_fk" FOREIGN KEY ("note_chunk_id") REFERENCES "public"."note_chunks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_extractions" ADD CONSTRAINT "concept_extractions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_extractions" ADD CONSTRAINT "concept_extractions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_extractions" ADD CONSTRAINT "concept_extractions_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_extractions" ADD CONSTRAINT "concept_extractions_evidence_bundle_id_evidence_bundles_id_fk" FOREIGN KEY ("evidence_bundle_id") REFERENCES "public"."evidence_bundles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_extractions" ADD CONSTRAINT "concept_extractions_source_note_id_notes_id_fk" FOREIGN KEY ("source_note_id") REFERENCES "public"."notes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_bundle_chunks" ADD CONSTRAINT "evidence_bundle_chunks_bundle_id_evidence_bundles_id_fk" FOREIGN KEY ("bundle_id") REFERENCES "public"."evidence_bundles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_bundle_chunks" ADD CONSTRAINT "evidence_bundle_chunks_note_chunk_id_note_chunks_id_fk" FOREIGN KEY ("note_chunk_id") REFERENCES "public"."note_chunks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_bundle_chunks" ADD CONSTRAINT "evidence_bundle_chunks_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_bundles" ADD CONSTRAINT "evidence_bundles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_bundles" ADD CONSTRAINT "evidence_bundles_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_bundles" ADD CONSTRAINT "evidence_bundles_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_claims" ADD CONSTRAINT "knowledge_claims_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_claims" ADD CONSTRAINT "knowledge_claims_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_claims" ADD CONSTRAINT "knowledge_claims_subject_concept_id_concepts_id_fk" FOREIGN KEY ("subject_concept_id") REFERENCES "public"."concepts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_claims" ADD CONSTRAINT "knowledge_claims_object_concept_id_concepts_id_fk" FOREIGN KEY ("object_concept_id") REFERENCES "public"."concepts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_claims" ADD CONSTRAINT "knowledge_claims_evidence_bundle_id_evidence_bundles_id_fk" FOREIGN KEY ("evidence_bundle_id") REFERENCES "public"."evidence_bundles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "concept_edge_evidence_edge_idx" ON "concept_edge_evidence" USING btree ("concept_edge_id");--> statement-breakpoint
CREATE INDEX "concept_edge_evidence_claim_idx" ON "concept_edge_evidence" USING btree ("claim_id");--> statement-breakpoint
CREATE INDEX "concept_edge_evidence_bundle_idx" ON "concept_edge_evidence" USING btree ("evidence_bundle_id");--> statement-breakpoint
CREATE INDEX "concept_edge_evidence_chunk_idx" ON "concept_edge_evidence" USING btree ("note_chunk_id");--> statement-breakpoint
CREATE INDEX "concept_extraction_chunks_chunk_idx" ON "concept_extraction_chunks" USING btree ("note_chunk_id");--> statement-breakpoint
CREATE INDEX "concept_extractions_project_idx" ON "concept_extractions" USING btree ("project_id","normalized_name");--> statement-breakpoint
CREATE INDEX "concept_extractions_concept_idx" ON "concept_extractions" USING btree ("concept_id");--> statement-breakpoint
CREATE INDEX "concept_extractions_bundle_idx" ON "concept_extractions" USING btree ("evidence_bundle_id");--> statement-breakpoint
CREATE INDEX "evidence_bundle_chunks_bundle_idx" ON "evidence_bundle_chunks" USING btree ("bundle_id");--> statement-breakpoint
CREATE INDEX "evidence_bundle_chunks_chunk_idx" ON "evidence_bundle_chunks" USING btree ("note_chunk_id");--> statement-breakpoint
CREATE INDEX "evidence_bundle_chunks_note_idx" ON "evidence_bundle_chunks" USING btree ("note_id");--> statement-breakpoint
CREATE INDEX "evidence_bundles_project_idx" ON "evidence_bundles" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "evidence_bundles_workspace_idx" ON "evidence_bundles" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "knowledge_claims_project_idx" ON "knowledge_claims" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "knowledge_claims_subject_idx" ON "knowledge_claims" USING btree ("subject_concept_id");--> statement-breakpoint
CREATE INDEX "knowledge_claims_object_idx" ON "knowledge_claims" USING btree ("object_concept_id");--> statement-breakpoint
CREATE INDEX "knowledge_claims_bundle_idx" ON "knowledge_claims" USING btree ("evidence_bundle_id");