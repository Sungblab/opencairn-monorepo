import { z } from "zod";

export const synthesisFormatValues = ["latex", "docx", "pdf", "md"] as const;
export const synthesisTemplateValues = [
  "ieee", "acm", "apa", "korean_thesis", "report",
] as const;
export const synthesisStatusValues = [
  "pending", "fetching", "synthesizing", "compiling",
  "completed", "failed", "cancelled",
] as const;
export const synthesisSourceTypeValues = ["s3_object", "note", "dr_result"] as const;
export const synthesisDocumentFormatValues = [
  "latex", "docx", "pdf", "md", "bibtex", "zip",
] as const;

export const createSynthesisRunSchema = z.object({
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid().nullable().optional(),
  format: z.enum(synthesisFormatValues),
  template: z.enum(synthesisTemplateValues),
  userPrompt: z.string().min(1).max(4000),
  explicitSourceIds: z.array(z.string().uuid()).max(50),
  noteIds: z.array(z.string().uuid()).max(50),
  autoSearch: z.boolean(),
});
export type CreateSynthesisRunInput = z.infer<typeof createSynthesisRunSchema>;

export const resynthesizeSchema = z.object({
  userPrompt: z.string().min(1).max(4000),
});

export const publishSynthesisDocumentSchema = z.object({
  format: z.enum(synthesisDocumentFormatValues).optional(),
});
export type PublishSynthesisDocumentInput = z.infer<typeof publishSynthesisDocumentSchema>;

export const synthesisStreamEventSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("queued"), runId: z.string().uuid() }),
  z.object({ kind: z.literal("fetching_sources"), count: z.number().int().nonnegative() }),
  z.object({ kind: z.literal("synthesizing"), thought: z.string().optional() }),
  z.object({ kind: z.literal("compiling"), format: z.enum(synthesisFormatValues) }),
  z.object({
    kind: z.literal("done"),
    docUrl: z.string(),
    format: z.enum(synthesisFormatValues),
    sourceCount: z.number().int().nonnegative(),
    tokensUsed: z.number().int().nonnegative(),
  }),
  z.object({ kind: z.literal("error"), code: z.string() }),
]);
export type SynthesisStreamEvent = z.infer<typeof synthesisStreamEventSchema>;

export interface SynthesisRunSummary {
  id: string;
  format: (typeof synthesisFormatValues)[number];
  template: (typeof synthesisTemplateValues)[number];
  status: (typeof synthesisStatusValues)[number];
  userPrompt: string;
  tokensUsed: number | null;
  createdAt: string;
}

export interface SynthesisSourceRow {
  id: string;
  sourceType: (typeof synthesisSourceTypeValues)[number];
  sourceId: string;
  title: string | null;
  tokenCount: number | null;
  included: boolean;
}

export interface SynthesisDocumentRow {
  id: string;
  format: (typeof synthesisDocumentFormatValues)[number];
  s3Key: string | null;
  bytes: number | null;
  createdAt: string;
}

export interface SynthesisRunDetail extends SynthesisRunSummary {
  workspaceId: string;
  projectId: string | null;
  autoSearch: boolean;
  sources: SynthesisSourceRow[];
  documents: SynthesisDocumentRow[];
}
