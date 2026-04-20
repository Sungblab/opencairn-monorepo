ALTER TYPE "public"."source_type" ADD VALUE 'unknown';--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "source_url" text;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "mime_type" text;