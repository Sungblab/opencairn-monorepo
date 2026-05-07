ALTER TABLE "user" ADD COLUMN "is_site_admin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "user_site_admin_idx" ON "user" USING btree ("is_site_admin") WHERE "user"."is_site_admin" = true;
