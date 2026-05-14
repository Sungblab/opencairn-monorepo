ALTER TABLE "task_feedback" DROP CONSTRAINT "task_feedback_target_user_unique";
--> statement-breakpoint
ALTER TABLE "task_feedback" ADD CONSTRAINT "task_feedback_target_user_unique" UNIQUE("project_id","target_type","target_id","user_id");
