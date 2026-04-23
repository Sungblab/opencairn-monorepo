import { z } from "zod";

// Kept in sync with packages/db/src/schema/enums.ts. If a new enum value is
// added there, add it here and bump the CI parity check.
export const researchModelValues = [
  "deep-research-preview-04-2026",
  "deep-research-max-preview-04-2026",
] as const;
export const researchBillingPathValues = ["byok", "managed"] as const;
export const researchStatusValues = [
  "planning",
  "awaiting_approval",
  "researching",
  "completed",
  "failed",
  "cancelled",
] as const;
export const researchTurnKindValues = [
  "plan_proposal",
  "user_feedback",
  "user_edit",
  "approval",
] as const;
export const researchTurnRoleValues = ["system", "user", "agent"] as const;
export const researchArtifactKindValues = [
  "thought_summary",
  "text_delta",
  "image",
  "citation",
] as const;

// --- Request schemas --------------------------------------------------------

export const createResearchRunSchema = z.object({
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid(),
  topic: z.string().min(1).max(2000),
  model: z.enum(researchModelValues),
  billingPath: z.enum(researchBillingPathValues),
});
export type CreateResearchRunInput = z.infer<typeof createResearchRunSchema>;

export const addTurnSchema = z.object({
  feedback: z.string().min(1).max(8000),
});
export type AddTurnInput = z.infer<typeof addTurnSchema>;

export const updatePlanSchema = z.object({
  editedText: z.string().min(1).max(32_000),
});
export type UpdatePlanInput = z.infer<typeof updatePlanSchema>;

// Optional override for approve. If omitted, the server picks the freshest
// user_edit if present, else the freshest plan_proposal.
export const approvePlanSchema = z.object({
  finalPlanText: z.string().min(1).max(32_000).optional(),
});
export type ApprovePlanInput = z.infer<typeof approvePlanSchema>;

export const listRunsQuerySchema = z.object({
  workspaceId: z.string().uuid(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListRunsQuery = z.infer<typeof listRunsQuerySchema>;

// --- Response shapes (types only; routes return JSON matching these) --------

export interface ResearchRunSummary {
  id: string;
  topic: string;
  model: (typeof researchModelValues)[number];
  status: (typeof researchStatusValues)[number];
  billingPath: (typeof researchBillingPathValues)[number];
  createdAt: string; // ISO
  updatedAt: string; // ISO
  completedAt?: string | null;
  totalCostUsdCents?: number | null;
  noteId?: string | null;
}

export interface ResearchTurn {
  id: string;
  seq: number;
  role: (typeof researchTurnRoleValues)[number];
  kind: (typeof researchTurnKindValues)[number];
  interactionId: string | null;
  content: string;
  createdAt: string;
}

export interface ResearchArtifact {
  id: string;
  seq: number;
  kind: (typeof researchArtifactKindValues)[number];
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface ResearchRunDetail extends ResearchRunSummary {
  workspaceId: string;
  projectId: string;
  currentInteractionId: string | null;
  approvedPlanText: string | null;
  error: { code: string; message: string; retryable: boolean } | null;
  totalCostUsdCents: number | null;
  noteId: string | null;
  completedAt: string | null;
  turns: ResearchTurn[];
  artifacts: ResearchArtifact[];
}

// --- SSE event envelope -----------------------------------------------------

export type ResearchStreamEvent =
  | { type: "status"; status: ResearchRunSummary["status"] }
  | {
      type: "turn";
      turn: ResearchTurn;
    }
  | {
      type: "artifact";
      artifact: ResearchArtifact;
    }
  | {
      type: "done";
      noteId: string | null;
      wsSlug?: string;
      projectId: string;
    }
  | {
      type: "error";
      code: string;
      message: string;
    };
