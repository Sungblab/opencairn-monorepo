import { z } from "zod";

const httpsUrl = z
  .string()
  .url()
  .refine((value) => value.startsWith("https://"), {
    message: "MCP server URL must use HTTPS",
  });

export const McpServerStatusSchema = z.enum([
  "active",
  "disabled",
  "auth_expired",
]);

export const McpServerCreateSchema = z.object({
  displayName: z.string().trim().min(1).max(64),
  serverUrl: httpsUrl,
  authHeaderName: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .default("Authorization"),
  authHeaderValue: z.string().max(4096).optional(),
});

export const McpServerUpdateSchema = z
  .object({
    displayName: z.string().trim().min(1).max(64).optional(),
    authHeaderName: z.string().trim().min(1).max(64).optional(),
    authHeaderValue: z.string().max(4096).nullable().optional(),
    status: McpServerStatusSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required",
  });

export const McpServerSummarySchema = z.object({
  id: z.string().uuid(),
  serverSlug: z.string(),
  displayName: z.string(),
  serverUrl: z.string().url(),
  authHeaderName: z.string(),
  hasAuth: z.boolean(),
  status: McpServerStatusSchema,
  lastSeenToolCount: z.number().int().nonnegative(),
  lastSeenAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const McpServerListResponseSchema = z.object({
  servers: z.array(McpServerSummarySchema),
});

export const McpServerTestResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ok"),
    toolCount: z.number().int().nonnegative(),
    sampleNames: z.array(z.string()).max(5),
    durationMs: z.number().int().nonnegative(),
  }),
  z.object({
    status: z.literal("auth_failed"),
    toolCount: z.number().int().nonnegative(),
    sampleNames: z.array(z.string()).max(5),
    durationMs: z.number().int().nonnegative(),
  }),
  z.object({
    status: z.literal("transport_error"),
    toolCount: z.number().int().nonnegative(),
    sampleNames: z.array(z.string()).max(5),
    durationMs: z.number().int().nonnegative(),
    errorMessage: z.string().optional(),
  }),
]);

export type McpServerStatus = z.infer<typeof McpServerStatusSchema>;
export type McpServerCreate = z.infer<typeof McpServerCreateSchema>;
export type McpServerUpdate = z.infer<typeof McpServerUpdateSchema>;
export type McpServerSummary = z.infer<typeof McpServerSummarySchema>;
export type McpServerTestResult = z.infer<typeof McpServerTestResultSchema>;
