CREATE TYPE "public"."llm_provider_kind" AS ENUM('gemini', 'ollama');--> statement-breakpoint
ALTER TABLE "user_preferences" ALTER COLUMN "llm_provider" SET DEFAULT 'gemini'::"public"."llm_provider_kind";--> statement-breakpoint
ALTER TABLE "user_preferences" ALTER COLUMN "llm_provider" SET DATA TYPE "public"."llm_provider_kind" USING "llm_provider"::"public"."llm_provider_kind";