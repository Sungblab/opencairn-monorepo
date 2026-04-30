CREATE TABLE "mcp_server_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_by_user_id" text NOT NULL,
	"label" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_prefix" text NOT NULL,
	"scopes" text[] DEFAULT '{"workspace:read"}' NOT NULL,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_server_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "mcp_server_tokens" ADD CONSTRAINT "mcp_server_tokens_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_server_tokens" ADD CONSTRAINT "mcp_server_tokens_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mcp_server_tokens_workspace_created_idx" ON "mcp_server_tokens" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "mcp_server_tokens_created_by_idx" ON "mcp_server_tokens" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "mcp_server_tokens_revoked_idx" ON "mcp_server_tokens" USING btree ("revoked_at");