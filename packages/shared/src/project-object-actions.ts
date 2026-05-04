import { z } from "zod";
import {
  agentFileKindSchema,
  createAgentFilePayloadSchema,
} from "./agent-files";

const actionRequestIdSchema = z.string().uuid().optional();
const objectIdSchema = z.string().uuid();
const exportFormatSchema = z.enum(["markdown", "html", "latex", "json", "csv", "xlsx", "pdf", "docx", "pptx", "image"]);
const exportProviderSchema = z.enum(["opencairn_download", "google_drive", "google_docs", "google_sheets", "google_slides"]);

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

export const projectObjectActionSchema = z.union([
  createProjectObjectActionSchema,
  updateProjectObjectContentActionSchema,
  exportProjectObjectActionSchema,
  compileProjectObjectActionSchema,
]);

export type ProjectObjectAction = z.infer<typeof projectObjectActionSchema>;

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
    objectId: objectIdSchema,
    provider: exportProviderSchema,
    format: exportFormatSchema.optional(),
  }),
  z.object({
    type: z.literal("project_object_compile_requested"),
    objectId: objectIdSchema,
    target: z.literal("pdf"),
  }),
]);

export type ProjectObjectActionEvent = z.infer<typeof projectObjectActionEventSchema>;
