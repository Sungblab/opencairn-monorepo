import { z } from "zod";

export const AGENT_FILE_KINDS = [
  "markdown",
  "text",
  "latex",
  "html",
  "code",
  "json",
  "csv",
  "xlsx",
  "pdf",
  "docx",
  "pptx",
  "image",
  "binary",
] as const;

export const agentFileKindSchema = z.enum(AGENT_FILE_KINDS);
export type AgentFileKind = z.infer<typeof agentFileKindSchema>;

export const agentFileIngestStatusSchema = z.enum([
  "not_started",
  "queued",
  "running",
  "completed",
  "failed",
]);
export type AgentFileIngestStatus = z.infer<typeof agentFileIngestStatusSchema>;

export const agentFileCompileStatusSchema = z.enum([
  "not_started",
  "queued",
  "running",
  "completed",
  "failed",
  "disabled",
]);
export type AgentFileCompileStatus = z.infer<typeof agentFileCompileStatusSchema>;

export const agentFileSourceSchema = z.enum([
  "agent_chat",
  "manual",
  "synthesis_export",
  "code_agent",
]);
export type AgentFileSource = z.infer<typeof agentFileSourceSchema>;

const safeFilenameSchema = z
  .string()
  .trim()
  .min(1)
  .max(180)
  .refine((value) => !/[\\/]/.test(value), "filename_must_be_basename")
  .refine((value) => !value.includes(".."), "filename_cannot_traverse")
  .refine((value) => !/[\r\n]/.test(value), "filename_cannot_break_headers");

const oneMiB = 1024 * 1024;

export const createAgentFilePayloadSchema = z
  .object({
    filename: safeFilenameSchema,
    title: z.string().trim().min(1).max(180).optional(),
    kind: agentFileKindSchema.optional(),
    mimeType: z.string().trim().min(1).max(200).optional(),
    content: z.string().max(oneMiB).optional(),
    base64: z.string().max(Math.ceil(oneMiB * 1.4)).optional(),
    folderId: z.string().uuid().nullable().optional(),
    startIngest: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    const hasContent = value.content !== undefined;
    const hasBase64 = value.base64 !== undefined;
    if (hasContent === hasBase64) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["content"],
        message: "provide_exactly_one_content_source",
      });
    }
  });

export type CreateAgentFilePayload = z.infer<typeof createAgentFilePayloadSchema>;

export const createAgentFilesSchema = z.object({
  projectId: z.string().uuid(),
  threadId: z.string().uuid().nullable().optional(),
  messageId: z.string().uuid().nullable().optional(),
  source: agentFileSourceSchema.optional(),
  files: z.array(createAgentFilePayloadSchema).min(1).max(5),
});

export type CreateAgentFilesInput = z.infer<typeof createAgentFilesSchema>;

export const agentFileSummarySchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid(),
  folderId: z.string().uuid().nullable(),
  title: z.string(),
  filename: z.string(),
  extension: z.string(),
  kind: agentFileKindSchema,
  mimeType: z.string(),
  bytes: z.number().int().nonnegative(),
  source: agentFileSourceSchema,
  versionGroupId: z.string().uuid(),
  version: z.number().int().positive(),
  ingestWorkflowId: z.string().nullable(),
  ingestStatus: agentFileIngestStatusSchema,
  sourceNoteId: z.string().uuid().nullable(),
  canvasNoteId: z.string().uuid().nullable(),
  compileStatus: agentFileCompileStatusSchema,
  compiledMimeType: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type AgentFileSummary = z.infer<typeof agentFileSummarySchema>;

export const updateAgentFileSchema = z
  .object({
    filename: safeFilenameSchema.optional(),
    title: z.string().trim().min(1).max(180).optional(),
    folderId: z.string().uuid().nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "empty_patch");

export const createAgentFileVersionSchema = z.object({
  filename: safeFilenameSchema.optional(),
  title: z.string().trim().min(1).max(180).optional(),
  content: z.string().max(oneMiB).optional(),
  base64: z.string().max(Math.ceil(oneMiB * 1.4)).optional(),
  startIngest: z.boolean().optional(),
}).superRefine((value, ctx) => {
  const hasContent = value.content !== undefined;
  const hasBase64 = value.base64 !== undefined;
  if (hasContent === hasBase64) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["content"],
      message: "provide_exactly_one_content_source",
    });
  }
});

export type CreateAgentFileVersionInput = z.infer<typeof createAgentFileVersionSchema>;

export const agentFileCreatedEventSchema = z.object({
  type: z.literal("agent_file_created"),
  file: agentFileSummarySchema,
});

export type AgentFileCreatedEvent = z.infer<typeof agentFileCreatedEventSchema>;

export function inferAgentFileKind(filename: string, mimeType?: string): AgentFileKind {
  const lower = filename.toLowerCase();
  const extension = lower.includes(".") ? lower.slice(lower.lastIndexOf(".") + 1) : "";
  if (mimeType === "application/pdf" || extension === "pdf") return "pdf";
  if (
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    extension === "docx"
  ) return "docx";
  if (
    mimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    extension === "pptx"
  ) return "pptx";
  if (
    mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    extension === "xlsx"
  ) return "xlsx";
  if (mimeType?.startsWith("image/") || ["png", "jpg", "jpeg", "webp", "gif", "svg"].includes(extension)) {
    return "image";
  }
  if (extension === "md" || extension === "markdown" || mimeType === "text/markdown") return "markdown";
  if (extension === "tex" || extension === "bib" || mimeType === "application/x-tex") return "latex";
  if (extension === "html" || extension === "htm" || mimeType === "text/html") return "html";
  if (extension === "json" || mimeType === "application/json") return "json";
  if (extension === "csv" || mimeType === "text/csv") return "csv";
  if (["py", "js", "jsx", "ts", "tsx", "css", "sql", "sh"].includes(extension)) return "code";
  if (mimeType?.startsWith("text/") || extension === "txt" || extension === "log") return "text";
  return "binary";
}

export function inferAgentFileMimeType(filename: string, kind?: AgentFileKind): string {
  const lower = filename.toLowerCase();
  const extension = lower.includes(".") ? lower.slice(lower.lastIndexOf(".") + 1) : "";
  if (kind === "pdf" || extension === "pdf") return "application/pdf";
  if (kind === "docx" || extension === "docx") {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (kind === "pptx" || extension === "pptx") {
    return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  }
  if (kind === "xlsx" || extension === "xlsx") {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (kind === "markdown" || extension === "md" || extension === "markdown") return "text/markdown";
  if (kind === "latex" || extension === "tex" || extension === "bib") return "application/x-tex";
  if (kind === "html" || extension === "html" || extension === "htm") return "text/html";
  if (kind === "json" || extension === "json") return "application/json";
  if (kind === "csv" || extension === "csv") return "text/csv";
  if (kind === "image") {
    if (extension === "svg") return "image/svg+xml";
    if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
    if (extension === "webp") return "image/webp";
    if (extension === "gif") return "image/gif";
    return "image/png";
  }
  if (kind === "code" || kind === "text") return "text/plain";
  return "application/octet-stream";
}
