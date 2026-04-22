import { z } from "zod";

// Source of a one-shot import. Extend carefully — each value pairs with
// a worker ImportWorkflow branch + source-specific discovery activity.
export const importSourceSchema = z.enum(["google_drive", "notion_zip"]);
export type ImportSource = z.infer<typeof importSourceSchema>;

// Where the import lands. 'new' creates a fresh project under the workspace;
// 'existing' anchors under an existing project + optional parent note.
export const importTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("new") }),
  z.object({
    kind: z.literal("existing"),
    projectId: z.string().uuid(),
    parentNoteId: z.string().uuid().nullable(),
  }),
]);
export type ImportTarget = z.infer<typeof importTargetSchema>;

export const startDriveImportSchema = z.object({
  workspaceId: z.string().uuid(),
  fileIds: z.array(z.string()).min(1).max(10_000),
  target: importTargetSchema,
});
export type StartDriveImportInput = z.infer<typeof startDriveImportSchema>;

export const startNotionImportSchema = z.object({
  workspaceId: z.string().uuid(),
  zipObjectKey: z.string().min(1),
  originalName: z.string().min(1).max(255),
  target: importTargetSchema,
});
export type StartNotionImportInput = z.infer<typeof startNotionImportSchema>;

export const importJobStatusSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  source: importSourceSchema,
  status: z.enum(["queued", "running", "completed", "failed"]),
  totalItems: z.number().int().nonnegative(),
  completedItems: z.number().int().nonnegative(),
  failedItems: z.number().int().nonnegative(),
  errorSummary: z.string().nullable(),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
});
export type ImportJobStatus = z.infer<typeof importJobStatusSchema>;

export const retryImportItemsSchema = z.object({
  itemPaths: z.array(z.string()).min(1).max(1000),
});
export type RetryImportItemsInput = z.infer<typeof retryImportItemsSchema>;

// Notion export ZIPs can be multi-GB — 5GB cap aligns with MinIO default
// multipart limits and matches the Temporal activity timeout budget.
export const notionUploadUrlSchema = z.object({
  workspaceId: z.string().uuid(),
  size: z
    .number()
    .int()
    .positive()
    .max(5 * 1024 * 1024 * 1024),
  originalName: z.string().min(1).max(255),
});
export type NotionUploadUrlInput = z.infer<typeof notionUploadUrlSchema>;

export const integrationStatusSchema = z.object({
  connected: z.boolean(),
  accountEmail: z.string().email().nullable(),
  scopes: z.array(z.string()).nullable(),
});
export type IntegrationStatus = z.infer<typeof integrationStatusSchema>;
