import { z } from "zod";
import { NoteVersionDiffSchema } from "./note-versions";
import {
  codeWorkspaceCommandRunRequestSchema,
  codeWorkspaceCreateRequestSchema,
  codeWorkspaceInstallResultSchema,
  codeWorkspaceInstallRequestSchema,
  codeWorkspacePatchPreviewSchema,
  codeWorkspacePatchSchema,
  codeWorkspacePreviewResultSchema,
  codeWorkspacePreviewRequestSchema,
} from "./code-project-workspaces";

export const agentActionStatusSchema = z.enum([
  "draft",
  "approval_required",
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
  "expired",
  "reverted",
]);

export const agentActionRiskSchema = z.enum([
  "low",
  "write",
  "destructive",
  "external",
  "expensive",
]);

export const agentActionApprovalModeSchema = z.enum([
  "require",
  "auto_safe",
]);

export const agentActionKindSchema = z.enum([
  "workflow.placeholder",
  "interaction.choice",
  "note.create",
  "note.create_from_markdown",
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
  "code_project.preview",
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

export const interactionChoiceOptionSchema = z
  .object({
    id: z.string().trim().min(1).max(80),
    label: z.string().trim().min(1).max(120),
    value: z.string().trim().min(1).max(2000),
    followup: z
      .object({
        kind: agentActionKindSchema,
        risk: agentActionRiskSchema,
        input: jsonRecordSchema,
        approvalMode: agentActionApprovalModeSchema.default("require"),
      })
      .strict()
      .optional(),
  })
  .strict();

export const interactionChoiceInputSchema = z
  .object({
    cardId: z.string().trim().min(1).max(120),
    prompt: z.string().trim().min(1).max(500),
    options: z.array(interactionChoiceOptionSchema).min(1).max(8),
    allowCustom: z.boolean().default(false),
    source: z
      .object({
        threadId: z.string().uuid().optional(),
        messageId: z.string().uuid().optional(),
      })
      .strict()
      .default({}),
  })
  .strict();

export const interactionChoiceRespondRequestSchema = z
  .object({
    optionId: z.string().trim().min(1).max(80).optional(),
    value: z.string().trim().min(1).max(2000),
    label: z.string().trim().min(1).max(120),
    threadId: z.string().uuid().optional(),
    userMessageId: z.string().uuid().optional(),
  })
  .strict();

export const interactionChoiceResultSchema =
  interactionChoiceRespondRequestSchema.extend({
    respondedAt: z.string().datetime(),
  });

export const noteCreateActionInputSchema = z
  .object({
    title: z.string().trim().min(1).max(300).default("Untitled"),
    folderId: z.string().uuid().nullable().default(null),
  })
  .strict();

export const noteCreateFromMarkdownActionInputSchema = z
  .object({
    title: z.string().trim().min(1).max(300).default("Untitled"),
    folderId: z.string().uuid().nullable().default(null),
    bodyMarkdown: z.string().trim().min(1).max(200_000),
  })
  .strict();

export const noteRenameActionInputSchema = z
  .object({
    noteId: z.string().uuid(),
    title: z.string().trim().min(1).max(300),
  })
  .strict();

export const noteMoveActionInputSchema = z
  .object({
    noteId: z.string().uuid(),
    folderId: z.string().uuid().nullable(),
  })
  .strict();

export const noteDeleteActionInputSchema = z
  .object({
    noteId: z.string().uuid(),
  })
  .strict();

export const noteRestoreActionInputSchema = noteDeleteActionInputSchema;

export const plateValueDraftSchema = z.array(z.record(z.unknown())).min(1).max(1000);

export const noteUpdateActionInputSchema = z
  .object({
    noteId: z.string().uuid(),
    draft: z
      .object({
        format: z.literal("plate_value_v1"),
        content: plateValueDraftSchema,
      })
      .strict(),
    reason: z.string().trim().max(500).optional(),
  })
  .strict();

export const noteUpdateApplyConstraintSchema = z.enum([
  "apply_must_transform_yjs_document",
  "capture_version_before_apply",
  "capture_version_after_apply",
  "reject_if_yjs_state_vector_changed",
  "preserve_plate_node_ids_when_possible",
]);

export const noteUpdatePreviewSchema = z
  .object({
    noteId: z.string().uuid(),
    source: z.literal("yjs"),
    current: z
      .object({
        contentText: z.string(),
        yjsStateVectorBase64: z.string().nullable(),
      })
      .strict(),
    draft: z
      .object({
        contentText: z.string(),
      })
      .strict(),
    diff: NoteVersionDiffSchema,
    applyConstraints: z.array(noteUpdateApplyConstraintSchema).min(1),
  })
  .strict();

export const noteUpdateApplyRequestSchema = z
  .object({
    yjsStateVectorBase64: z.string().trim().min(1),
  })
  .strict();

export const noteUpdateApplyResultSchema = z
  .object({
    ok: z.literal(true),
    noteId: z.string().uuid(),
    applied: z
      .object({
        source: z.literal("yjs"),
        yjsStateVectorBase64: z.string().trim().min(1),
        contentText: z.string(),
      })
      .strict(),
    versionCapture: z
      .object({
        before: z.object({
          created: z.boolean(),
          version: z.number().int().positive(),
        }),
        after: z.object({
          created: z.boolean(),
          version: z.number().int().positive(),
        }),
      })
      .strict(),
    summary: z
      .object({
        changedBlocks: z.number().int().nonnegative(),
        addedWords: z.number().int().nonnegative(),
        removedWords: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

export const noteActionInputByKind = {
  "note.create": noteCreateActionInputSchema,
  "note.create_from_markdown": noteCreateFromMarkdownActionInputSchema,
  "note.update": noteUpdateActionInputSchema,
  "note.rename": noteRenameActionInputSchema,
  "note.move": noteMoveActionInputSchema,
  "note.delete": noteDeleteActionInputSchema,
  "note.restore": noteRestoreActionInputSchema,
} as const;

export const createAgentActionRequestSchema = z
  .object({
    requestId: z.string().uuid().optional(),
    sourceRunId: z.string().trim().min(1).max(200).optional(),
    kind: agentActionKindSchema,
    risk: agentActionRiskSchema,
    approvalMode: agentActionApprovalModeSchema.default("auto_safe"),
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
    if (value.kind === "code_project.install" && value.risk !== "external") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["risk"],
        message: "dependency_installs_must_require_external_approval",
      });
    }
    if (value.kind === "code_project.preview" && value.risk !== "external") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["risk"],
        message: "hosted_previews_must_require_external_approval",
      });
    }
    validatePhase2ANoteActionInput(value, ctx);
    validateCodeProjectActionInput(value, ctx);
    validateInteractionChoiceActionInput(value, ctx);
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
export type AgentActionApprovalMode = z.infer<typeof agentActionApprovalModeSchema>;
export type AgentActionKind = z.infer<typeof agentActionKindSchema>;
export type InteractionChoiceOption = z.infer<typeof interactionChoiceOptionSchema>;
export type InteractionChoiceInput = z.infer<typeof interactionChoiceInputSchema>;
export type InteractionChoiceRespondRequest = z.infer<typeof interactionChoiceRespondRequestSchema>;
export type InteractionChoiceResult = z.infer<typeof interactionChoiceResultSchema>;
export type NoteCreateActionInput = z.infer<typeof noteCreateActionInputSchema>;
export type NoteCreateFromMarkdownActionInput = z.infer<typeof noteCreateFromMarkdownActionInputSchema>;
export type NoteRenameActionInput = z.infer<typeof noteRenameActionInputSchema>;
export type NoteMoveActionInput = z.infer<typeof noteMoveActionInputSchema>;
export type NoteDeleteActionInput = z.infer<typeof noteDeleteActionInputSchema>;
export type NoteRestoreActionInput = z.infer<typeof noteRestoreActionInputSchema>;
export type NoteUpdateActionInput = z.infer<typeof noteUpdateActionInputSchema>;
export type NoteUpdatePreview = z.infer<typeof noteUpdatePreviewSchema>;
export type NoteUpdateApplyRequest = z.infer<typeof noteUpdateApplyRequestSchema>;
export type NoteUpdateApplyResult = z.infer<typeof noteUpdateApplyResultSchema>;
export type Phase2ANoteActionKind = Exclude<
  keyof typeof noteActionInputByKind,
  "note.update"
>;
export type Phase2ANoteActionInput =
  | NoteCreateActionInput
  | NoteCreateFromMarkdownActionInput
  | NoteRenameActionInput
  | NoteMoveActionInput
  | NoteDeleteActionInput
  | NoteRestoreActionInput;
export type CreateAgentActionRequest = z.input<typeof createAgentActionRequestSchema>;
export type TransitionAgentActionStatusRequest = z.infer<typeof transitionAgentActionStatusRequestSchema>;
export type AgentAction = z.infer<typeof agentActionSchema>;
export type AgentActionEvent = z.infer<typeof agentActionEventSchema>;

export function parseNoteUpdatePreview(value: unknown): NoteUpdatePreview | null {
  const parsed = noteUpdatePreviewSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function parseNoteUpdateApplyResult(value: unknown): NoteUpdateApplyResult | null {
  const parsed = noteUpdateApplyResultSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function parseCodeWorkspacePatchPreview(value: unknown) {
  const parsed = codeWorkspacePatchPreviewSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function parseCodeWorkspaceInstallRequest(value: unknown) {
  const parsed = codeWorkspaceInstallRequestSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function parseCodeWorkspaceInstallResult(value: unknown) {
  const parsed = codeWorkspaceInstallResultSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function parseCodeWorkspacePreviewRequest(value: unknown) {
  const parsed = codeWorkspacePreviewRequestSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function parseCodeWorkspacePreviewResult(value: unknown) {
  const parsed = codeWorkspacePreviewResultSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function parseInteractionChoiceInput(value: unknown): InteractionChoiceInput | null {
  const parsed = interactionChoiceInputSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

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

function validatePhase2ANoteActionInput(
  value: {
    kind: AgentActionKind;
    input?: Record<string, unknown>;
  },
  ctx: z.RefinementCtx,
): void {
  const schema = noteActionInputByKind[value.kind as Phase2ANoteActionKind];
  if (!schema) return;

  const parsed = schema.safeParse(value.input ?? {});
  if (parsed.success) return;
  for (const issue of parsed.error.issues) {
    ctx.addIssue({
      ...issue,
      path: ["input", ...issue.path],
    });
  }
}

function validateCodeProjectActionInput(
  value: {
    kind: AgentActionKind;
    input?: Record<string, unknown>;
  },
  ctx: z.RefinementCtx,
): void {
  const input = value.input ?? {};
  const schema =
    value.kind === "code_project.create"
      ? codeWorkspaceCreateRequestSchema
      : value.kind === "code_project.patch"
        ? codeWorkspacePatchSchema
        : value.kind === "code_project.run"
          ? codeWorkspaceCommandRunRequestSchema
          : value.kind === "code_project.install"
            ? codeWorkspaceInstallRequestSchema
            : value.kind === "code_project.preview"
              ? codeWorkspacePreviewRequestSchema
            : null;
  if (!schema) return;
  const parsed = schema.safeParse(input);
  if (parsed.success) return;
  for (const issue of parsed.error.issues) {
    ctx.addIssue({
      ...issue,
      path: ["input", ...issue.path],
    });
  }
}

function validateInteractionChoiceActionInput(
  value: {
    kind: AgentActionKind;
    input?: Record<string, unknown>;
  },
  ctx: z.RefinementCtx,
): void {
  if (value.kind !== "interaction.choice") return;
  const parsed = interactionChoiceInputSchema.safeParse(value.input ?? {});
  if (parsed.success) return;
  for (const issue of parsed.error.issues) {
    ctx.addIssue({
      ...issue,
      path: ["input", ...issue.path],
    });
  }
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
