import { z } from "zod";
import {
  agentFileKindSchema,
  createAgentFilePayloadSchema,
} from "./agent-files";

const actionRequestIdSchema = z.string().uuid().optional();
const objectIdSchema = z.string().uuid();
const exportFormatSchema = z.enum(["markdown", "html", "latex", "json", "csv", "xlsx", "pdf", "docx", "pptx", "image"]);
const exportProviderSchema = z.enum(["opencairn_download", "google_drive", "google_docs", "google_sheets", "google_slides"]);
const googleExportProviderSchema = z.enum(["google_drive", "google_docs", "google_sheets", "google_slides"]);
const documentGenerationFormatSchema = z.enum(["pdf", "docx", "pptx", "xlsx"]);
const documentGenerationTemplateSchema = z.enum([
  "report",
  "brief",
  "research_summary",
  "deck",
  "spreadsheet",
  "custom",
]);
const documentGenerationArtifactModeSchema = z.literal("object_storage");
const documentGenerationPublishTargetSchema = z.literal("agent_file");
const documentGenerationSourceQualitySignalSchema = z.enum([
  "metadata_fallback",
  "unsupported_source",
  "source_corrupt",
  "source_oversized",
  "scanned_no_text",
  "no_extracted_text",
  "source_hydration_failed",
  "source_token_budget_exceeded",
]);
const safeGeneratedFilenameSchema = z
  .string()
  .trim()
  .min(1)
  .max(180)
  .refine((value) => !/[\\/]/.test(value), "filename_must_be_basename")
  .refine((value) => !value.includes(".."), "filename_cannot_traverse")
  .refine((value) => !/[\r\n]/.test(value), "filename_cannot_break_headers");

const forbiddenScopeFields = ["workspaceId", "workspace_id", "projectId", "project_id", "userId", "user_id"] as const;

function rejectScopeFields(value: Record<string, unknown>, ctx: z.RefinementCtx): void {
  for (const field of forbiddenScopeFields) {
    if (field in value) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [field],
        message: "scope_fields_are_server_injected",
      });
    }
  }
}

export const createProjectObjectActionSchema = z
  .object({
    type: z.literal("create_project_object"),
    requestId: actionRequestIdSchema,
    object: createAgentFilePayloadSchema,
  })
  .strict()
  .superRefine(rejectScopeFields);

export const updateProjectObjectContentActionSchema = z
  .object({
    type: z.literal("update_project_object_content"),
    requestId: actionRequestIdSchema,
    objectId: objectIdSchema,
    filename: z.string().trim().min(1).max(180).optional(),
    title: z.string().trim().min(1).max(180).optional(),
    content: z.string().max(1024 * 1024).optional(),
    base64: z.string().max(Math.ceil(1024 * 1024 * 1.4)).optional(),
    startIngest: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    rejectScopeFields(value, ctx);
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

export const exportProjectObjectActionSchema = z
  .object({
    type: z.literal("export_project_object"),
    requestId: actionRequestIdSchema,
    objectId: objectIdSchema,
    format: exportFormatSchema.optional(),
    provider: exportProviderSchema.default("opencairn_download"),
  })
  .strict()
  .superRefine(rejectScopeFields);

export const compileProjectObjectActionSchema = z
  .object({
    type: z.literal("compile_project_object"),
    requestId: actionRequestIdSchema,
    objectId: objectIdSchema,
    target: z.literal("pdf").default("pdf"),
  })
  .strict()
  .superRefine(rejectScopeFields);

export const documentGenerationSourceSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("note"),
      noteId: z.string().uuid(),
      versionId: z.string().uuid().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("agent_file"),
      objectId: objectIdSchema,
      version: z.number().int().positive().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("chat_thread"),
      threadId: z.string().uuid(),
      messageIds: z.array(z.string().uuid()).min(1).max(50).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("research_run"),
      runId: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      type: z.literal("synthesis_run"),
      runId: z.string().uuid(),
      documentId: z.string().uuid().optional(),
    })
    .strict(),
]);

export const documentGenerationDestinationSchema = z
  .object({
    filename: safeGeneratedFilenameSchema,
    title: z.string().trim().min(1).max(180).optional(),
    folderId: z.string().uuid().nullable().optional(),
    publishAs: documentGenerationPublishTargetSchema.default("agent_file"),
    startIngest: z.boolean().default(false),
  })
  .strict();

export const documentGenerationRequestSchema = z
  .object({
    format: documentGenerationFormatSchema,
    prompt: z.string().trim().min(1).max(8000),
    locale: z.string().trim().min(2).max(35).default("ko"),
    template: documentGenerationTemplateSchema.default("report"),
    sources: z.array(documentGenerationSourceSchema).max(50).default([]),
    destination: documentGenerationDestinationSchema,
    artifactMode: documentGenerationArtifactModeSchema.default("object_storage"),
  })
  .strict()
  .superRefine(rejectScopeFields);

export const generateProjectObjectActionSchema = z
  .object({
    type: z.literal("generate_project_object"),
    requestId: actionRequestIdSchema,
    generation: documentGenerationRequestSchema,
  })
  .strict()
  .superRefine(rejectScopeFields);

export const projectObjectActionSchema = z.union([
  createProjectObjectActionSchema,
  updateProjectObjectContentActionSchema,
  exportProjectObjectActionSchema,
  compileProjectObjectActionSchema,
  generateProjectObjectActionSchema,
]);

export type ProjectObjectAction = z.infer<typeof projectObjectActionSchema>;
export type GenerateProjectObjectAction = z.infer<typeof generateProjectObjectActionSchema>;
export type DocumentGenerationFormat = z.infer<typeof documentGenerationFormatSchema>;
export type DocumentGenerationSource = z.infer<typeof documentGenerationSourceSchema>;
export type DocumentGenerationDestination = z.infer<typeof documentGenerationDestinationSchema>;
export type DocumentGenerationRequest = z.infer<typeof documentGenerationRequestSchema>;

export const documentGenerationResultSchema = z
  .object({
    ok: z.literal(true),
    requestId: z.string().uuid(),
    workflowId: z.string().min(1),
    format: documentGenerationFormatSchema,
    object: z.lazy(() => projectObjectSummarySchema),
    artifact: z
      .object({
        objectKey: z.string().min(1),
        mimeType: z.string().min(1),
        bytes: z.number().int().nonnegative(),
      })
      .strict(),
    sourceQuality: z
      .object({
        signals: z.array(documentGenerationSourceQualitySignalSchema).default([]),
        sources: z.array(
          z
            .object({
              id: z.string().min(1),
              kind: z.string().min(1),
              title: z.string().min(1),
              signals: z.array(documentGenerationSourceQualitySignalSchema),
            })
            .strict(),
        ).default([]),
      })
      .strict()
      .optional(),
  })
  .strict();

export const documentGenerationErrorResultSchema = z
  .object({
    ok: z.literal(false),
    requestId: z.string().uuid(),
    workflowId: z.string().min(1).optional(),
    format: documentGenerationFormatSchema.optional(),
    errorCode: z.string().trim().min(1).max(120),
    retryable: z.boolean().default(false),
    sourceQuality: z
      .object({
        signals: z.array(documentGenerationSourceQualitySignalSchema).default([]),
        sources: z.array(
          z
            .object({
              id: z.string().min(1),
              kind: z.string().min(1),
              title: z.string().min(1),
              signals: z.array(documentGenerationSourceQualitySignalSchema),
            })
            .strict(),
        ).default([]),
      })
      .strict()
      .optional(),
  })
  .strict();

export const documentGenerationTerminalResultSchema = z.union([
  documentGenerationResultSchema,
  documentGenerationErrorResultSchema,
]);

export type DocumentGenerationResult = z.infer<typeof documentGenerationResultSchema>;
export type DocumentGenerationErrorResult = z.infer<typeof documentGenerationErrorResultSchema>;
export type DocumentGenerationTerminalResult = z.infer<typeof documentGenerationTerminalResultSchema>;

export const projectObjectSummarySchema = z.object({
  id: z.string().uuid(),
  objectType: z.literal("agent_file"),
  title: z.string(),
  filename: z.string(),
  kind: agentFileKindSchema,
  mimeType: z.string(),
  projectId: z.string().uuid(),
});

export type ProjectObjectSummary = z.infer<typeof projectObjectSummarySchema>;

export const googleWorkspaceExportResultSchema = z
  .object({
    ok: z.literal(true),
    requestId: z.string().uuid(),
    workflowId: z.string().min(1),
    objectId: objectIdSchema,
    provider: googleExportProviderSchema,
    externalObjectId: z.string().min(1),
    externalUrl: z.string().url(),
    exportedMimeType: z.string().min(1),
    exportStatus: z.literal("completed"),
  })
  .strict();

export const googleWorkspaceExportErrorResultSchema = z
  .object({
    ok: z.literal(false),
    requestId: z.string().uuid(),
    workflowId: z.string().min(1).optional(),
    objectId: objectIdSchema,
    provider: googleExportProviderSchema,
    exportStatus: z.literal("failed"),
    errorCode: z.string().trim().min(1).max(120),
    retryable: z.boolean().default(false),
  })
  .strict();

export const googleWorkspaceExportTerminalResultSchema = z.union([
  googleWorkspaceExportResultSchema,
  googleWorkspaceExportErrorResultSchema,
]);

export type GoogleExportProvider = z.infer<typeof googleExportProviderSchema>;
export type GoogleWorkspaceExportResult = z.infer<typeof googleWorkspaceExportResultSchema>;
export type GoogleWorkspaceExportErrorResult = z.infer<typeof googleWorkspaceExportErrorResultSchema>;
export type GoogleWorkspaceExportTerminalResult = z.infer<typeof googleWorkspaceExportTerminalResultSchema>;

export const projectObjectActionEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("project_object_created"),
    object: projectObjectSummarySchema,
  }),
  z.object({
    type: z.literal("project_object_updated"),
    object: projectObjectSummarySchema,
  }),
  z.object({
    type: z.literal("project_object_export_requested"),
    requestId: z.string().uuid().optional(),
    objectId: objectIdSchema,
    provider: exportProviderSchema,
    format: exportFormatSchema.optional(),
    workflowHint: z.literal("google_workspace_export").optional(),
  }),
  z.object({
    type: z.literal("project_object_export_ready"),
    object: projectObjectSummarySchema,
    provider: z.literal("opencairn_download"),
    format: exportFormatSchema.optional(),
    downloadUrl: z.string().min(1),
    filename: z.string().min(1),
    mimeType: z.string().min(1),
    bytes: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal("project_object_compile_requested"),
    objectId: objectIdSchema,
    target: z.literal("pdf"),
  }),
  z.object({
    type: z.literal("project_object_generation_requested"),
    requestId: z.string().uuid(),
    generation: documentGenerationRequestSchema,
    workflowHint: z.literal("document_generation"),
  }),
  z.object({
    type: z.literal("project_object_generation_completed"),
    result: documentGenerationResultSchema,
  }),
  z.object({
    type: z.literal("project_object_generation_failed"),
    result: documentGenerationErrorResultSchema,
  }),
  z.object({
    type: z.literal("project_object_export_completed"),
    result: googleWorkspaceExportResultSchema,
  }),
  z.object({
    type: z.literal("project_object_export_failed"),
    result: googleWorkspaceExportErrorResultSchema,
  }),
]);

export type ProjectObjectActionEvent = z.infer<typeof projectObjectActionEventSchema>;
