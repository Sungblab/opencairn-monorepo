ALTER TABLE "user_integrations" DROP CONSTRAINT "user_integrations_user_provider_unique";--> statement-breakpoint
ALTER TABLE "user_integrations" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "user_integrations" ADD CONSTRAINT "user_integrations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_integrations" ADD CONSTRAINT "user_integrations_user_workspace_provider_unique" UNIQUE("user_id","workspace_id","provider");