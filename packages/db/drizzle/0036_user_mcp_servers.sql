CREATE TYPE "public"."mcp_server_status" AS ENUM('active', 'disabled', 'auth_expired');--> statement-breakpoint
CREATE TABLE "user_mcp_servers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"server_slug" text NOT NULL,
	"display_name" text NOT NULL,
	"server_url" text NOT NULL,
	"auth_header_name" text DEFAULT 'Authorization' NOT NULL,
	"auth_header_value_encrypted" "bytea",
	"status" "mcp_server_status" DEFAULT 'active' NOT NULL,
	"last_seen_tool_count" integer DEFAULT 0 NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_mcp_servers_user_slug_unique" UNIQUE("user_id","server_slug")
);
--> statement-breakpoint
ALTER TABLE "user_mcp_servers" ADD CONSTRAINT "user_mcp_servers_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;