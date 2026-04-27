import { z } from "zod";

// Plan 11A — chat scope foundation. The DB enums in
// packages/db/src/schema/conversations.ts (scope_type, rag_mode,
// conversation_message_role) are the source of truth at the storage layer;
// these Zod schemas mirror them at the API boundary so request validation
// stays in one place. Keep the `.values` arrays in lockstep with the SQL
// enum on every change.

export const ScopeTypeSchema = z.enum(["page", "project", "workspace"]);
export type ScopeType = z.infer<typeof ScopeTypeSchema>;

export const RagModeSchema = z.enum(["strict", "expand"]);
export type RagMode = z.infer<typeof RagModeSchema>;

// Memory chips (l3/l4/l2) accepted by the API in 11A but not yet rendered
// in the chat UI — Plan 11B owns the L1–L4 surface. Keeping the literals
// in this enum lets the chip add/remove routes accept them without a
// follow-up schema change.
export const ChipTypeSchema = z.enum([
  "page",
  "project",
  "workspace",
  "memory:l3",
  "memory:l4",
  "memory:l2",
]);
export type ChipType = z.infer<typeof ChipTypeSchema>;

export const AttachedChipSchema = z.object({
  type: ChipTypeSchema,
  // Page/project/workspace ids are uuids; memory chip ids are opaque
  // strings (Plan 11B). Loose `min(1)` keeps both shapes valid here and
  // defers tighter validation to the route handlers, where the workspace
  // boundary check already runs against the resolved target row.
  id: z.string().min(1),
  label: z.string().optional(),
  manual: z.boolean(),
});
export type AttachedChip = z.infer<typeof AttachedChipSchema>;

export const MemoryFlagsSchema = z.object({
  l3_global: z.boolean(),
  l3_workspace: z.boolean(),
  l4: z.boolean(),
  l2: z.boolean(),
});
export type MemoryFlags = z.infer<typeof MemoryFlagsSchema>;

export const CitationSchema = z.object({
  source_type: z.enum(["note", "concept", "external"]),
  source_id: z.string().min(1),
  snippet: z.string(),
  locator: z
    .object({
      page: z.number().int().optional(),
      // tuple of [start_line, end_line] — both inclusive.
      line_range: z.tuple([z.number().int(), z.number().int()]).optional(),
      start_ms: z.number().int().optional(),
      end_ms: z.number().int().optional(),
    })
    .optional(),
});
export type Citation = z.infer<typeof CitationSchema>;

export const ConversationMessageRoleSchema = z.enum([
  "user",
  "assistant",
  "system",
  "tool",
]);
export type ConversationMessageRole = z.infer<typeof ConversationMessageRoleSchema>;

// ── Request bodies ──────────────────────────────────────────────────────

export const CreateConversationBodySchema = z.object({
  workspaceId: z.string().uuid(),
  scopeType: ScopeTypeSchema,
  scopeId: z.string().min(1),
  attachedChips: z.array(AttachedChipSchema),
  ragMode: RagModeSchema.default("strict"),
  memoryFlags: MemoryFlagsSchema,
  title: z.string().max(200).optional(),
});
export type CreateConversationBody = z.infer<typeof CreateConversationBodySchema>;

export const PatchConversationBodySchema = z.object({
  ragMode: RagModeSchema.optional(),
  memoryFlags: MemoryFlagsSchema.optional(),
  title: z.string().max(200).optional(),
});
export type PatchConversationBody = z.infer<typeof PatchConversationBodySchema>;

export const SendMessageBodySchema = z.object({
  conversationId: z.string().uuid(),
  // Lower bound 1 prevents empty user turns hitting the SSE handler;
  // upper bound 32k chars matches the practical token-budget ceiling for
  // a single user prompt (further trimming happens server-side).
  content: z.string().min(1).max(32_000),
});
export type SendMessageBody = z.infer<typeof SendMessageBodySchema>;

export const AddChipBodySchema = z.object({
  type: ChipTypeSchema,
  id: z.string().min(1),
});
export type AddChipBody = z.infer<typeof AddChipBodySchema>;

export const PinBodySchema = z.object({
  noteId: z.string().uuid(),
  blockId: z.string().min(1),
});
export type PinBody = z.infer<typeof PinBodySchema>;

// ── Response shapes ─────────────────────────────────────────────────────

// Pin warning surfaced when a 409 comes back from /messages/:id/pin.
export const PinDeltaSchema = z.object({
  hiddenSources: z.array(
    z.object({
      sourceType: z.string(),
      sourceId: z.string(),
      snippet: z.string(),
    }),
  ),
  hiddenUsers: z.array(
    z.object({
      userId: z.string(),
      reason: z.string(),
    }),
  ),
});
export type PinDelta = z.infer<typeof PinDeltaSchema>;
