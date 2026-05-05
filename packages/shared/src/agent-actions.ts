import { z } from "zod";

export const agentActionStatusSchema = z.enum([
  "draft",
  "approval_required",
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
  "reverted",
]);

export const agentActionRiskSchema = z.enum([
  "low",
  "write",
  "destructive",
  "external",
  "expensive",
]);

export const agentActionKindSchema = z.enum([
  "workflow.placeholder",
  "note.create",
  "note.update",
  "note.rename",
  "note.move",
  "note.delete",
  "note.restore",
  "note.comment",
  "file.create",
  "file.update",
  "file.delete",
  "file.compile",
  "file.generate",
  "file.export",
  "import.upload",
  "import.markdown_zip",
  "import.drive",
  "import.notion",
  "import.literature",
  "import.web",
  "export.note",
  "export.project",
  "export.file",
  "export.workspace",
  "export.provider",
  "code_project.create",
  "code_project.patch",
  "code_project.rename",
  "code_project.delete",
  "code_project.install",
  "code_project.run",
  "code_project.package",
]);

const MAX_AGENT_ACTION_PAYLOAD_DEPTH = 20;

const forbiddenScopeFields = new Set([
  "workspaceId",
  "workspace_id",
  "projectId",
  "project_id",
  "userId",
  "user_id",
  "actorUserId",
  "actor_user_id",
]);

const jsonRecordSchema = z
  .record(z.unknown())
  .default({})
  .superRefine(rejectNestedScopeFields);

export const createAgentActionRequestSchema = z
  .object({
    requestId: z.string().uuid().optional(),
    sourceRunId: z.string().trim().min(1).max(200).optional(),
    kind: agentActionKindSchema,
    risk: agentActionRiskSchema,
    input: jsonRecordSchema.optional(),
    preview: jsonRecordSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    rejectOwnScopeFields(value, ctx);
    if (value.kind === "workflow.placeholder" && value.risk !== "low") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["risk"],
        message: "placeholder_actions_must_be_low_risk",
      });
    }
  });

export const listAgentActionsQuerySchema = z.object({
  status: agentActionStatusSchema.optional(),
  kind: agentActionKindSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const transitionAgentActionStatusRequestSchema = z
  .object({
    status: agentActionStatusSchema,
    preview: jsonRecordSchema.optional(),
    result: jsonRecordSchema.optional(),
    errorCode: z.string().trim().min(1).max(120).nullable().optional(),
  })
  .strict()
  .superRefine(rejectOwnScopeFields);

export const agentActionSchema = z.object({
  id: z.string().uuid(),
  requestId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid(),
  actorUserId: z.string().min(1),
  sourceRunId: z.string().nullable(),
  kind: agentActionKindSchema,
  status: agentActionStatusSchema,
  risk: agentActionRiskSchema,
  input: z.record(z.unknown()),
  preview: z.record(z.unknown()).nullable(),
  result: z.record(z.unknown()).nullable(),
  errorCode: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const agentActionEventSchema = z.object({
  type: z.literal("agent_action_status"),
  action: agentActionSchema,
});

export type AgentActionStatus = z.infer<typeof agentActionStatusSchema>;
export type AgentActionRisk = z.infer<typeof agentActionRiskSchema>;
export type AgentActionKind = z.infer<typeof agentActionKindSchema>;
export type CreateAgentActionRequest = z.infer<typeof createAgentActionRequestSchema>;
export type TransitionAgentActionStatusRequest = z.infer<typeof transitionAgentActionStatusRequestSchema>;
export type AgentAction = z.infer<typeof agentActionSchema>;
export type AgentActionEvent = z.infer<typeof agentActionEventSchema>;

function rejectOwnScopeFields(value: Record<string, unknown>, ctx: z.RefinementCtx): void {
  for (const key of Object.keys(value)) {
    if (forbiddenScopeFields.has(key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: "scope_fields_are_server_injected",
      });
    }
  }
}

function rejectNestedScopeFields(value: Record<string, unknown>, ctx: z.RefinementCtx): void {
  walkForScopeFields(value, [], ctx, 0);
}

function walkForScopeFields(
  value: unknown,
  path: Array<string | number>,
  ctx: z.RefinementCtx,
  depth: number,
): void {
  if (depth > MAX_AGENT_ACTION_PAYLOAD_DEPTH) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path,
      message: "payload_too_deep",
    });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkForScopeFields(item, [...path, index], ctx, depth + 1));
    return;
  }
  if (value == null || typeof value !== "object") return;

  for (const [key, nested] of Object.entries(value)) {
    const nextPath = [...path, key];
    if (forbiddenScopeFields.has(key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: nextPath,
        message: "scope_fields_are_server_injected",
      });
    }
    walkForScopeFields(nested, nextPath, ctx, depth + 1);
  }
}
