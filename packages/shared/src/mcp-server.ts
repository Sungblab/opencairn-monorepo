import { z } from "zod";

const uuid = z.string().uuid();
const isoDateTime = z.string().datetime();

export const McpServerScopeSchema = z.literal("workspace:read");

export const McpSearchNotesInputSchema = z.object({
  query: z.string().trim().min(1).max(2000),
  limit: z.number().int().positive().max(25).default(10),
  projectId: uuid.optional(),
});

export const McpGetNoteInputSchema = z.object({
  noteId: uuid,
});

export const McpListProjectsInputSchema = z.object({
  limit: z.number().int().positive().max(100).default(50),
});

export const McpSearchNoteHitSchema = z.object({
  noteId: uuid,
  title: z.string(),
  projectId: uuid,
  projectName: z.string(),
  snippet: z.string(),
  sourceType: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  updatedAt: isoDateTime,
  vectorScore: z.number().nullable(),
  bm25Score: z.number().nullable(),
  rrfScore: z.number(),
});

export const McpSearchNotesResultSchema = z.object({
  hits: z.array(McpSearchNoteHitSchema),
});

export const McpGetNoteResultSchema = z.object({
  noteId: uuid,
  title: z.string(),
  projectId: uuid,
  projectName: z.string(),
  sourceType: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  contentText: z.string(),
  updatedAt: isoDateTime,
});

export const McpProjectSummarySchema = z.object({
  projectId: uuid,
  name: z.string(),
  description: z.string().nullable(),
  updatedAt: isoDateTime,
});

export const McpListProjectsResultSchema = z.object({
  projects: z.array(McpProjectSummarySchema),
});

export const McpTokenCreateSchema = z.object({
  workspaceId: uuid,
  label: z.string().trim().min(1).max(80),
  expiresAt: isoDateTime.nullable().optional(),
});

export const McpTokenSummarySchema = z.object({
  id: uuid,
  workspaceId: uuid,
  label: z.string(),
  tokenPrefix: z.string(),
  scopes: z.array(McpServerScopeSchema),
  expiresAt: isoDateTime.nullable(),
  lastUsedAt: isoDateTime.nullable(),
  revokedAt: isoDateTime.nullable(),
  createdAt: isoDateTime,
});

export const McpTokenCreatedSchema = McpTokenSummarySchema.extend({
  token: z.string().regex(/^ocmcp_[A-Za-z0-9_-]{43}$/),
});

export type McpServerScope = z.infer<typeof McpServerScopeSchema>;
export type McpSearchNotesInput = z.infer<typeof McpSearchNotesInputSchema>;
export type McpGetNoteInput = z.infer<typeof McpGetNoteInputSchema>;
export type McpListProjectsInput = z.infer<typeof McpListProjectsInputSchema>;
export type McpSearchNoteHit = z.infer<typeof McpSearchNoteHitSchema>;
export type McpSearchNotesResult = z.infer<typeof McpSearchNotesResultSchema>;
export type McpGetNoteResult = z.infer<typeof McpGetNoteResultSchema>;
export type McpProjectSummary = z.infer<typeof McpProjectSummarySchema>;
export type McpListProjectsResult = z.infer<typeof McpListProjectsResultSchema>;
export type McpTokenCreate = z.infer<typeof McpTokenCreateSchema>;
export type McpTokenSummary = z.infer<typeof McpTokenSummarySchema>;
export type McpTokenCreated = z.infer<typeof McpTokenCreatedSchema>;
