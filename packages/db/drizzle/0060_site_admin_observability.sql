CREATE TABLE IF NOT EXISTS "api_request_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "request_id" text NOT NULL,
  "method" text NOT NULL,
  "path" text NOT NULL,
  "query" text,
  "status_code" integer NOT NULL,
  "duration_ms" integer NOT NULL,
  "user_id" text,
  "ip" text,
  "user_agent" text,
  "referer" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "api_request_logs_user_id_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."user"("id")
    ON DELETE set null ON UPDATE no action
);

CREATE INDEX IF NOT EXISTS "api_request_logs_created_idx"
  ON "api_request_logs" USING btree ("created_at");
CREATE INDEX IF NOT EXISTS "api_request_logs_user_created_idx"
  ON "api_request_logs" USING btree ("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "api_request_logs_path_created_idx"
  ON "api_request_logs" USING btree ("path", "created_at");
CREATE INDEX IF NOT EXISTS "api_request_logs_status_created_idx"
  ON "api_request_logs" USING btree ("status_code", "created_at");

CREATE TABLE IF NOT EXISTS "llm_usage_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text,
  "workspace_id" uuid,
  "provider" text NOT NULL,
  "model" text NOT NULL,
  "operation" text NOT NULL,
  "tokens_in" integer DEFAULT 0 NOT NULL,
  "tokens_out" integer DEFAULT 0 NOT NULL,
  "cached_tokens" integer DEFAULT 0 NOT NULL,
  "cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
  "cost_krw" numeric(14, 4) DEFAULT '0' NOT NULL,
  "usd_to_krw" numeric(12, 4) DEFAULT '1650' NOT NULL,
  "input_usd_per_1m" numeric(12, 6) DEFAULT '0' NOT NULL,
  "output_usd_per_1m" numeric(12, 6) DEFAULT '0' NOT NULL,
  "source_type" text,
  "source_id" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "llm_usage_events_user_id_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."user"("id")
    ON DELETE set null ON UPDATE no action,
  CONSTRAINT "llm_usage_events_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id")
    ON DELETE set null ON UPDATE no action
);

CREATE INDEX IF NOT EXISTS "llm_usage_events_created_idx"
  ON "llm_usage_events" USING btree ("created_at");
CREATE INDEX IF NOT EXISTS "llm_usage_events_user_created_idx"
  ON "llm_usage_events" USING btree ("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "llm_usage_events_workspace_created_idx"
  ON "llm_usage_events" USING btree ("workspace_id", "created_at");
CREATE INDEX IF NOT EXISTS "llm_usage_events_provider_model_created_idx"
  ON "llm_usage_events" USING btree ("provider", "model", "created_at");
CREATE INDEX IF NOT EXISTS "llm_usage_events_source_idx"
  ON "llm_usage_events" USING btree ("source_type", "source_id");
