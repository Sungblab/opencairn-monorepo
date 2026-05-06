import { z } from "zod";
import { agentActionRiskSchema } from "./agent-actions";

export const agenticPlanStatusSchema = z.enum([
  "draft",
  "approval_required",
  "queued",
  "running",
  "blocked",
  "completed",
  "failed",
  "cancelled",
]);

export const agenticPlanStepStatusSchema = z.enum([
  "draft",
  "approval_required",
  "queued",
  "running",
  "blocked",
  "completed",
  "failed",
  "cancelled",
  "skipped",
]);

export const agenticPlanStepKindSchema = z.enum([
  "note.review_update",
  "document.generate",
  "file.export",
  "code.run",
  "code.repair",
  "import.retry",
  "agent.run",
  "manual.review",
]);

export const agenticPlanTargetSchema = z
  .object({
    workspaceId: z.string().uuid(),
    projectId: z.string().uuid(),
    noteId: z.string().uuid().optional(),
    documentId: z.string().uuid().optional(),
    sourceId: z.string().uuid().optional(),
    codeProjectId: z.string().uuid().optional(),
  })
  .strict();

export const createAgenticPlanTargetSchema = z
  .object({
    noteId: z.string().uuid().optional(),
    documentId: z.string().uuid().optional(),
    sourceId: z.string().uuid().optional(),
    codeProjectId: z.string().uuid().optional(),
  })
  .strict()
  .default({});

export const agenticPlanStepSchema = z
  .object({
    id: z.string().uuid(),
    planId: z.string().uuid(),
    ordinal: z.number().int().min(1),
    kind: agenticPlanStepKindSchema,
    title: z.string().min(1),
    rationale: z.string().min(1),
    status: agenticPlanStepStatusSchema,
    risk: agentActionRiskSchema,
    input: z.record(z.unknown()).default({}),
    linkedRunType: z.string().min(1).nullable().optional(),
    linkedRunId: z.string().min(1).nullable().optional(),
    errorCode: z.string().min(1).nullable().optional(),
    errorMessage: z.string().min(1).nullable().optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    completedAt: z.string().datetime().nullable().optional(),
  })
  .strict();

export const agenticPlanSchema = z
  .object({
    id: z.string().uuid(),
    workspaceId: z.string().uuid(),
    projectId: z.string().uuid(),
    actorUserId: z.string().min(1),
    title: z.string().min(1),
    goal: z.string().min(3),
    status: agenticPlanStatusSchema,
    target: agenticPlanTargetSchema,
    plannerKind: z.literal("deterministic"),
    summary: z.string().min(1),
    currentStepOrdinal: z.number().int().min(1).nullable().optional(),
    steps: z.array(agenticPlanStepSchema),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    completedAt: z.string().datetime().nullable().optional(),
  })
  .strict();

export const createAgenticPlanRequestSchema = z
  .object({
    goal: z.string().trim().min(3).max(2_000),
    title: z.string().trim().min(1).max(160).optional(),
    target: createAgenticPlanTargetSchema,
  })
  .strict();

export const listAgenticPlansQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
    status: agenticPlanStatusSchema.optional(),
  })
  .strict();

export const agenticPlanParamsSchema = z
  .object({
    projectId: z.string().uuid(),
    planId: z.string().uuid(),
  })
  .strict();

export const startAgenticPlanRequestSchema = z
  .object({
    stepId: z.string().uuid().optional(),
  })
  .strict()
  .default({});

export const recoverAgenticPlanStepRequestSchema = z
  .object({
    stepId: z.string().uuid(),
    strategy: z.enum(["retry", "manual_review"]),
    note: z.string().trim().max(1_000).optional(),
  })
  .strict();

export type AgenticPlanStatus = z.infer<typeof agenticPlanStatusSchema>;
export type AgenticPlanStepStatus = z.infer<typeof agenticPlanStepStatusSchema>;
export type AgenticPlanStepKind = z.infer<typeof agenticPlanStepKindSchema>;
export type AgenticPlanTarget = z.infer<typeof agenticPlanTargetSchema>;
export type CreateAgenticPlanTarget = z.infer<typeof createAgenticPlanTargetSchema>;
export type AgenticPlanStep = z.infer<typeof agenticPlanStepSchema>;
export type AgenticPlan = z.infer<typeof agenticPlanSchema>;
export type CreateAgenticPlanRequest = z.input<typeof createAgenticPlanRequestSchema>;
export type ListAgenticPlansQuery = z.infer<typeof listAgenticPlansQuerySchema>;
export type StartAgenticPlanRequest = z.input<typeof startAgenticPlanRequestSchema>;
export type RecoverAgenticPlanStepRequest = z.input<typeof recoverAgenticPlanStepRequestSchema>;
