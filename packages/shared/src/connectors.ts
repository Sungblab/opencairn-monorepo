import { z } from "zod";

export const ConnectorProviderSchema = z.enum([
  "google_drive",
  "github",
  "notion",
  "mcp_custom",
]);

export const ConnectorAuthTypeSchema = z.enum([
  "oauth",
  "pat",
  "static_header",
  "none",
]);

export const ConnectorAccountStatusSchema = z.enum([
  "active",
  "disabled",
  "auth_expired",
  "revoked",
]);

export const ConnectorSourceKindSchema = z.enum([
  "drive_folder",
  "drive_file",
  "github_repo",
  "notion_workspace",
  "notion_page_tree",
  "mcp_server",
]);

export const ConnectorSyncModeSchema = z.enum([
  "one_shot",
  "manual_resync",
  "scheduled",
]);

export const ConnectorSourceStatusSchema = z.enum([
  "active",
  "disabled",
  "auth_expired",
  "deleted",
]);

export const ConnectorJobTypeSchema = z.enum([
  "import",
  "sync",
  "refresh_tools",
  "preview",
]);

export const ConnectorJobStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
]);

export const ConnectorRiskLevelSchema = z.enum([
  "safe_read",
  "import",
  "write",
  "destructive",
  "external_send",
  "unknown",
]);

export const ExternalObjectTypeSchema = z.enum([
  "file",
  "folder",
  "page",
  "database",
  "repo",
  "issue",
  "pull_request",
  "comment",
  "action_run",
  "code_file",
  "mcp_result",
]);

export const ConnectorAccountCreateSchema = z.object({
  provider: ConnectorProviderSchema,
  authType: ConnectorAuthTypeSchema,
  accountLabel: z.string().trim().min(1).max(128),
  accountEmail: z.string().email().nullable().optional(),
  externalAccountId: z.string().trim().min(1).max(512).nullable().optional(),
  scopes: z.array(z.string().min(1).max(256)).default([]),
  status: ConnectorAccountStatusSchema.default("active"),
});

export const ConnectorSourceCreateSchema = z.object({
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid().nullable().optional(),
  accountId: z.string().uuid(),
  provider: ConnectorProviderSchema,
  sourceKind: ConnectorSourceKindSchema,
  externalId: z.string().trim().min(1).max(1024),
  displayName: z.string().trim().min(1).max(256),
  syncMode: ConnectorSyncModeSchema.default("one_shot"),
  permissions: z
    .object({
      read: z.boolean().default(true),
      import: z.boolean().default(false),
      write: z.boolean().default(false),
      destructive: z.boolean().default(false),
      externalSend: z.boolean().default(false),
    })
    .default({}),
});

export const ExternalObjectRefSchema = z.object({
  workspaceId: z.string().uuid(),
  provider: ConnectorProviderSchema,
  sourceId: z.string().uuid(),
  externalId: z.string().trim().min(1).max(1024),
  externalUrl: z.string().url().nullable().optional(),
  objectType: ExternalObjectTypeSchema,
  externalVersion: z.string().trim().max(512).nullable().optional(),
  noteId: z.string().uuid().nullable().optional(),
  conceptId: z.string().uuid().nullable().optional(),
  conceptEdgeId: z.string().uuid().nullable().optional(),
  connectorJobId: z.string().uuid().nullable().optional(),
});

export const ConnectorMcpToolSchema = z.object({
  sourceId: z.string().uuid(),
  toolName: z.string().trim().min(1).max(256),
  description: z.string().max(4096).nullable().optional(),
  inputSchema: z.record(z.unknown()).default({}),
  riskLevel: ConnectorRiskLevelSchema,
  enabled: z.boolean().default(false),
});

export const ConnectorAuditEventSchema = z.object({
  workspaceId: z.string().uuid(),
  userId: z.string().min(1),
  accountId: z.string().uuid().nullable().optional(),
  sourceId: z.string().uuid().nullable().optional(),
  connectorJobId: z.string().uuid().nullable().optional(),
  action: z.string().trim().min(1).max(128),
  riskLevel: ConnectorRiskLevelSchema,
  provider: ConnectorProviderSchema,
  metadata: z.record(z.unknown()).default({}),
});

export type ConnectorProvider = z.infer<typeof ConnectorProviderSchema>;
export type ConnectorAuthType = z.infer<typeof ConnectorAuthTypeSchema>;
export type ConnectorAccountStatus = z.infer<
  typeof ConnectorAccountStatusSchema
>;
export type ConnectorSourceKind = z.infer<typeof ConnectorSourceKindSchema>;
export type ConnectorSyncMode = z.infer<typeof ConnectorSyncModeSchema>;
export type ConnectorSourceStatus = z.infer<
  typeof ConnectorSourceStatusSchema
>;
export type ConnectorJobType = z.infer<typeof ConnectorJobTypeSchema>;
export type ConnectorJobStatus = z.infer<typeof ConnectorJobStatusSchema>;
export type ConnectorRiskLevel = z.infer<typeof ConnectorRiskLevelSchema>;
export type ExternalObjectType = z.infer<typeof ExternalObjectTypeSchema>;
export type ConnectorAccountCreate = z.infer<
  typeof ConnectorAccountCreateSchema
>;
export type ConnectorSourceCreate = z.infer<
  typeof ConnectorSourceCreateSchema
>;
export type ExternalObjectRef = z.infer<typeof ExternalObjectRefSchema>;
export type ConnectorMcpTool = z.infer<typeof ConnectorMcpToolSchema>;
export type ConnectorAuditEvent = z.infer<typeof ConnectorAuditEventSchema>;
