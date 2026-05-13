ALTER TYPE "public"."suggestion_type" ADD VALUE IF NOT EXISTS 'curator_ontology_violation';--> statement-breakpoint
ALTER TYPE "public"."suggestion_type" ADD VALUE IF NOT EXISTS 'curator_relation_refinement';--> statement-breakpoint
ALTER TYPE "public"."suggestion_type" ADD VALUE IF NOT EXISTS 'curator_hierarchy_cycle';
