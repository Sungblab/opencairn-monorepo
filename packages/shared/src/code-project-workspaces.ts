import { z } from "zod";

export const CODE_WORKSPACE_MAX_DEPTH = 16;
export const CODE_WORKSPACE_MAX_ENTRIES = 2000;
export const CODE_WORKSPACE_MAX_PATH_LENGTH = 512;

const forbiddenScopeFields = [
  "workspaceId",
  "workspace_id",
  "projectId",
  "project_id",
  "userId",
  "user_id",
  "actorUserId",
  "actor_user_id",
] as const;

export const codeWorkspaceEntryKindSchema = z.enum(["file", "directory"]);
export const codeWorkspaceLanguageSchema = z.enum([
  "javascript",
  "typescript",
  "python",
  "html",
  "css",
  "json",
  "markdown",
  "tsx",
  "jsx",
  "react",
  "other",
]);

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

function rejectUnknownFields(
  value: Record<string, unknown>,
  allowedFields: ReadonlySet<string>,
  ctx: z.RefinementCtx,
): void {
  for (const field of Object.keys(value)) {
    if (allowedFields.has(field) || forbiddenScopeFields.includes(field as never)) {
      continue;
    }
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [field],
      message: "unrecognized_key",
    });
  }
}

export function normalizeCodeWorkspacePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) throw new Error("path_required");
  if (trimmed.length > CODE_WORKSPACE_MAX_PATH_LENGTH) {
    throw new Error("path_length_exceeded");
  }
  if (trimmed.startsWith("/") || trimmed.startsWith("\\")) {
    throw new Error("path_must_be_relative");
  }
  if (/^[a-zA-Z]:[\\/]/.test(trimmed)) {
    throw new Error("path_must_not_include_drive_letter");
  }
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) {
    throw new Error("path_cannot_include_control_characters");
  }
  if (trimmed.includes("\\")) {
    throw new Error("path_must_use_forward_slashes");
  }

  const parts = trimmed.split("/");
  if (parts.some((part) => part === "" || part === ".")) {
    throw new Error("path_must_be_normalized");
  }
  if (parts.some((part) => part === "..")) {
    throw new Error("path_cannot_traverse");
  }
  if (parts.length > CODE_WORKSPACE_MAX_DEPTH) {
    throw new Error("path_depth_exceeded");
  }
  return parts.join("/");
}

const normalizedPathSchema = z
  .string()
  .trim()
  .min(1)
  .transform((value, ctx) => {
    try {
      return normalizeCodeWorkspacePath(value);
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: error instanceof Error ? error.message : "invalid_path",
      });
      return z.NEVER;
    }
  });

export const codeWorkspaceFileEntrySchema = z
  .object({
    path: normalizedPathSchema,
    kind: z.literal("file"),
    language: z.string().trim().min(1).max(64).optional(),
    mimeType: z.string().trim().min(1).max(200).optional(),
    bytes: z.number().int().nonnegative(),
    contentHash: z.string().trim().min(1).max(200),
    objectKey: z.string().trim().min(1).max(1024).optional(),
    inlineContent: z.string().max(1024 * 1024).optional(),
  })
  .strict();

export const codeWorkspaceDirectoryEntrySchema = z
  .object({
    path: normalizedPathSchema,
    kind: z.literal("directory"),
  })
  .strict();

export const codeWorkspaceEntrySchema = z.union([
  codeWorkspaceFileEntrySchema,
  codeWorkspaceDirectoryEntrySchema,
]);

export const codeWorkspaceManifestSchema = z
  .object({
    entries: z.array(codeWorkspaceEntrySchema).max(CODE_WORKSPACE_MAX_ENTRIES).default([]),
  })
  .strict()
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    for (const [index, entry] of value.entries.entries()) {
      if (typeof entry.path !== "string") continue;
      const key = entry.path.toLowerCase();
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["entries", index, "path"],
          message: "duplicate_path_collision",
        });
      }
      seen.add(key);
    }
  });

export const codeWorkspaceCreateRequestSchema = z
  .object({
    requestId: z.string().uuid().optional(),
    name: z.string().trim().min(1).max(180),
    description: z.string().trim().max(2000).optional(),
    language: codeWorkspaceLanguageSchema.optional(),
    framework: z.string().trim().min(1).max(80).optional(),
    manifest: codeWorkspaceManifestSchema.default({ entries: [] }),
    sourceRunId: z.string().trim().min(1).max(200).optional(),
    sourceActionId: z.string().uuid().optional(),
  })
  .passthrough()
  .superRefine((value, ctx) => {
    rejectScopeFields(value, ctx);
    rejectUnknownFields(
      value,
      new Set([
        "requestId",
        "name",
        "description",
        "language",
        "framework",
        "manifest",
        "sourceRunId",
        "sourceActionId",
      ]),
      ctx,
    );
  });

export const codeWorkspacePatchOperationSchema = z
  .discriminatedUnion("op", [
    z
      .object({
        op: z.literal("create"),
        path: normalizedPathSchema,
        afterHash: z.string().trim().min(1).max(200),
        inlineContent: z.string().max(1024 * 1024).optional(),
        objectKey: z.string().trim().min(1).max(1024).optional(),
      })
      .strict(),
    z
      .object({
        op: z.literal("update"),
        path: normalizedPathSchema,
        beforeHash: z.string().trim().min(1).max(200),
        afterHash: z.string().trim().min(1).max(200),
        inlineContent: z.string().max(1024 * 1024).optional(),
        objectKey: z.string().trim().min(1).max(1024).optional(),
      })
      .strict(),
    z
      .object({
        op: z.literal("delete"),
        path: normalizedPathSchema,
        beforeHash: z.string().trim().min(1).max(200),
      })
      .strict(),
    z
      .object({
        op: z.literal("rename"),
        path: normalizedPathSchema,
        newPath: normalizedPathSchema,
        beforeHash: z.string().trim().min(1).max(200).optional(),
        afterHash: z.string().trim().min(1).max(200).optional(),
      })
      .strict(),
    z
      .object({
        op: z.literal("move"),
        path: normalizedPathSchema,
        newPath: normalizedPathSchema,
        beforeHash: z.string().trim().min(1).max(200).optional(),
        afterHash: z.string().trim().min(1).max(200).optional(),
      })
      .strict(),
  ])
  .superRefine((value, ctx) => {
    if ("newPath" in value && value.path.toLowerCase() === value.newPath.toLowerCase()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["newPath"],
        message: "new_path_must_differ",
      });
    }
  });

export const codeWorkspacePatchPreviewSchema = z
  .object({
    filesChanged: z.number().int().nonnegative(),
    additions: z.number().int().nonnegative(),
    deletions: z.number().int().nonnegative(),
    summary: z.string().trim().min(1).max(1000),
  })
  .strict();

export const codeWorkspacePatchRiskSchema = z.enum([
  "write",
  "destructive",
  "expensive",
]);

export const codeWorkspaceCommandSchema = z.enum(["lint", "test", "build"]);

export const codeWorkspacePackageManagerSchema = z.enum(["pnpm", "npm", "yarn"]);

export const codeWorkspaceInstallRequestSchema = z
  .object({
    requestId: z.string().uuid().optional(),
    codeWorkspaceId: z.string().uuid(),
    snapshotId: z.string().uuid(),
    packageManager: codeWorkspacePackageManagerSchema.default("pnpm"),
    packages: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(214),
            version: z.string().trim().min(1).max(120).optional(),
            dev: z.boolean().default(false),
          })
          .strict(),
      )
      .min(1)
      .max(50),
    network: z.literal("required"),
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .passthrough()
  .superRefine((value, ctx) => {
    rejectScopeFields(value, ctx);
    rejectUnknownFields(
      value,
      new Set([
        "requestId",
        "codeWorkspaceId",
        "snapshotId",
        "packageManager",
        "packages",
        "network",
        "reason",
      ]),
      ctx,
    );
  });

export const codeWorkspacePreviewRequestSchema = z
  .object({
    requestId: z.string().uuid().optional(),
    codeWorkspaceId: z.string().uuid(),
    snapshotId: z.string().uuid(),
    mode: z.literal("static"),
    entryPath: normalizedPathSchema.default("index.html"),
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .passthrough()
  .superRefine((value, ctx) => {
    rejectScopeFields(value, ctx);
    rejectUnknownFields(
      value,
      new Set([
        "requestId",
        "codeWorkspaceId",
        "snapshotId",
        "mode",
        "entryPath",
        "reason",
      ]),
      ctx,
    );
  });

export const codeWorkspacePreviewResultSchema = z
  .object({
    ok: z.literal(true),
    kind: z.literal("code_project.preview"),
    mode: z.literal("static"),
    codeWorkspaceId: z.string().uuid(),
    snapshotId: z.string().uuid(),
    entryPath: normalizedPathSchema,
    previewUrl: z.string().trim().min(1).max(1024),
    assetsBaseUrl: z.string().trim().min(1).max(1024),
  })
  .strict();

export const codeWorkspaceCommandRunRequestSchema = z
  .object({
    requestId: z.string().uuid().optional(),
    codeWorkspaceId: z.string().uuid(),
    snapshotId: z.string().uuid(),
    command: codeWorkspaceCommandSchema,
    timeoutMs: z.number().int().min(1_000).max(300_000).default(60_000),
  })
  .passthrough()
  .superRefine((value, ctx) => {
    rejectScopeFields(value, ctx);
    rejectUnknownFields(
      value,
      new Set([
        "requestId",
        "codeWorkspaceId",
        "snapshotId",
        "command",
        "timeoutMs",
      ]),
      ctx,
    );
  });

export const codeWorkspaceCommandRunLogSchema = z
  .object({
    stream: z.enum(["stdout", "stderr", "system"]),
    text: z.string().max(64 * 1024),
    timestamp: z.string().datetime().optional(),
  })
  .strict();

export const codeWorkspaceCommandRunResultSchema = z
  .object({
    ok: z.boolean(),
    codeWorkspaceId: z.string().uuid().optional(),
    snapshotId: z.string().uuid().optional(),
    command: codeWorkspaceCommandSchema,
    exitCode: z.number().int(),
    durationMs: z.number().int().nonnegative().optional(),
    logs: z.array(codeWorkspaceCommandRunLogSchema).max(200),
    summary: z.string().trim().max(2000).optional(),
    archiveUrl: z.string().trim().min(1).max(1024).optional(),
  })
  .strict();

export const codeWorkspacePatchSchema = z
  .object({
    requestId: z.string().uuid().optional(),
    codeWorkspaceId: z.string().uuid(),
    baseSnapshotId: z.string().uuid(),
    operations: z.array(codeWorkspacePatchOperationSchema).min(1).max(500),
    preview: codeWorkspacePatchPreviewSchema,
    risk: codeWorkspacePatchRiskSchema.default("write"),
  })
  .passthrough()
  .superRefine((value, ctx) => {
    rejectScopeFields(value, ctx);
    rejectUnknownFields(
      value,
      new Set([
        "requestId",
        "codeWorkspaceId",
        "baseSnapshotId",
        "operations",
        "preview",
        "risk",
      ]),
      ctx,
    );
    const touched = new Set<string>();
    for (const [index, op] of value.operations.entries()) {
      const key = "newPath" in op ? op.newPath.toLowerCase() : op.path.toLowerCase();
      if (touched.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["operations", index, "path"],
          message: "duplicate_patch_target",
        });
      }
      touched.add(key);
    }
  });

export const codeWorkspaceSnapshotSchema = z
  .object({
    id: z.string().uuid(),
    parentSnapshotId: z.string().uuid().nullable().default(null),
    treeHash: z.string().trim().min(1).max(200),
    manifest: codeWorkspaceManifestSchema,
  })
  .strict();

export const codeWorkspacePackageResultSchema = z
  .object({
    ok: z.literal(true),
    snapshotId: z.string().uuid(),
    objectKey: z.string().trim().min(1).max(1024),
    filename: z.string().trim().min(1).max(180),
    bytes: z.number().int().nonnegative(),
  })
  .strict();

export type CodeWorkspaceEntryKind = z.infer<typeof codeWorkspaceEntryKindSchema>;
export type CodeWorkspaceManifest = z.infer<typeof codeWorkspaceManifestSchema>;
export type CodeWorkspaceCreateRequest = z.infer<typeof codeWorkspaceCreateRequestSchema>;
export type CodeWorkspacePatch = z.infer<typeof codeWorkspacePatchSchema>;
export type CodeWorkspaceCommand = z.infer<typeof codeWorkspaceCommandSchema>;
export type CodeWorkspaceCommandRunRequest = z.infer<typeof codeWorkspaceCommandRunRequestSchema>;
export type CodeWorkspaceCommandRunLog = z.infer<typeof codeWorkspaceCommandRunLogSchema>;
export type CodeWorkspaceCommandRunResult = z.infer<typeof codeWorkspaceCommandRunResultSchema>;
export type CodeWorkspacePreviewResult = z.infer<typeof codeWorkspacePreviewResultSchema>;
export type CodeWorkspaceSnapshot = z.infer<typeof codeWorkspaceSnapshotSchema>;
export type CodeWorkspacePackageResult = z.infer<typeof codeWorkspacePackageResultSchema>;
