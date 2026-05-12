DROP INDEX IF EXISTS "chat_threads_updated_at_idx";--> statement-breakpoint
ALTER TABLE "chat_threads" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_threads_project_id_idx" ON "chat_threads" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "chat_threads_updated_at_idx" ON "chat_threads" USING btree ("workspace_id","project_id","user_id","updated_at");
