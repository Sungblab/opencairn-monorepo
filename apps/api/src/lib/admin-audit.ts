import { adminAuditEvents, db, type DB, type Tx } from "@opencairn/db";

type AdminAuditTarget =
  | {
      targetType: "user";
      targetId: string;
      targetUserId: string;
    }
  | {
      targetType: "workspace";
      targetId: string;
      targetWorkspaceId: string;
    }
  | {
      targetType: "report";
      targetId: string;
      targetReportId: string;
    }
  | {
      targetType: "credit_campaign";
      targetId: string;
    };

export type AdminAuditAction =
  | "site_admin.grant"
  | "site_admin.revoke"
  | "user.plan.update"
  | "workspace.plan.update"
  | "credit.manual_grant"
  | "credit.campaign.create"
  | "credit.campaign.update"
  | "credit.campaign.grant"
  | "report.status.update";

export async function recordAdminAuditEvent(
  input: {
    actorUserId: string | null;
    action: AdminAuditAction;
    target: AdminAuditTarget;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  },
  client: DB | Tx = db,
) {
  const [event] = await client
    .insert(adminAuditEvents)
    .values({
      actorUserId: input.actorUserId,
      action: input.action,
      targetType: input.target.targetType,
      targetId: input.target.targetId,
      targetUserId:
        input.target.targetType === "user" ? input.target.targetUserId : null,
      targetWorkspaceId:
        input.target.targetType === "workspace"
          ? input.target.targetWorkspaceId
          : null,
      targetReportId:
        input.target.targetType === "report"
          ? input.target.targetReportId
          : null,
      before: input.before,
      after: input.after,
      metadata: input.metadata ?? {},
    })
    .returning({ id: adminAuditEvents.id });

  return event;
}
