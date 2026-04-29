CREATE TYPE "public"."notification_frequency" AS ENUM('instant', 'digest_15min', 'digest_daily');--> statement-breakpoint
CREATE TABLE "user_notification_preferences" (
	"user_id" text NOT NULL,
	"kind" "notification_kind" NOT NULL,
	"email_enabled" boolean NOT NULL,
	"frequency" "notification_frequency" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_notification_preferences_user_id_kind_pk" PRIMARY KEY("user_id","kind")
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "emailed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "email_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "last_email_error" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "locale" text DEFAULT 'ko' NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_locale_check" CHECK ("locale" IN ('ko','en'));--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "timezone" text DEFAULT 'Asia/Seoul' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_notification_preferences" ADD CONSTRAINT "user_notification_preferences_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_pending_email_idx" ON "notifications" USING btree ("created_at") WHERE "notifications"."emailed_at" IS NULL AND "notifications"."email_attempts" < 3;