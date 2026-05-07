CREATE TYPE "admin_audit_action" AS ENUM (
  'site_admin.grant',
  'site_admin.revoke',
  'user.plan.update',
  'workspace.plan.update',
  'report.status.update'
);
--> statement-breakpoint
ALTER TABLE "admin_audit_events"
  ALTER COLUMN "action" TYPE "admin_audit_action"
  USING "action"::"admin_audit_action";
