import { z } from "zod";

// Mirror of apps/worker/src/runtime/events.py (Pydantic).
// Keep the two in sync — both define the NDJSON wire format read by the
// frontend (streaming UI) and written by the Python agent runtime.

const baseFields = {
  run_id: z.string(),
  workspace_id: z.string(),
  agent_name: z.string(),
  seq: z.number().int().nonnegative(),
  ts: z.number(),
  parent_seq: z.number().int().nullable().default(null),
};

export const ScopeSchema = z.enum(["page", "project", "workspace"]);
export type Scope = z.infer<typeof ScopeSchema>;

export const AgentStartSchema = z.object({
  ...baseFields,
  type: z.literal("agent_start"),
  scope: ScopeSchema,
  input: z.record(z.unknown()),
  parent_run_id: z.string().nullable().default(null),
});

export const AgentEndSchema = z.object({
  ...baseFields,
  type: z.literal("agent_end"),
  output: z.record(z.unknown()),
  duration_ms: z.number().int().nonnegative(),
});

export const AgentErrorSchema = z.object({
  ...baseFields,
  type: z.literal("agent_error"),
  error_class: z.string(),
  message: z.string(),
  retryable: z.boolean(),
});

export const ModelEndSchema = z.object({
  ...baseFields,
  type: z.literal("model_end"),
  model_id: z.string(),
  prompt_tokens: z.number().int().nonnegative(),
  completion_tokens: z.number().int().nonnegative(),
  cached_tokens: z.number().int().nonnegative().default(0),
  cost_krw: z.number().int().nonnegative(),
  finish_reason: z.string(),
  latency_ms: z.number().int().nonnegative(),
});

export const ToolUseSchema = z.object({
  ...baseFields,
  type: z.literal("tool_use"),
  tool_call_id: z.string(),
  tool_name: z.string(),
  input_args: z.record(z.unknown()),
  input_hash: z.string(),
  concurrency_safe: z.boolean(),
});

export const ToolResultSchema = z.object({
  ...baseFields,
  type: z.literal("tool_result"),
  tool_call_id: z.string(),
  ok: z.boolean(),
  output: z.unknown(),
  duration_ms: z.number().int().nonnegative(),
  cached: z.boolean().default(false),
});

export const HandoffSchema = z.object({
  ...baseFields,
  type: z.literal("handoff"),
  from_agent: z.string(),
  to_agent: z.string(),
  child_run_id: z.string(),
  scope: ScopeSchema,
  reason: z.string(),
});

export const AwaitingInputSchema = z.object({
  ...baseFields,
  type: z.literal("awaiting_input"),
  interrupt_id: z.string(),
  prompt: z.string(),
  schema: z.record(z.unknown()).nullable().default(null),
});

export const CustomEventSchema = z.object({
  ...baseFields,
  type: z.literal("custom"),
  label: z.string(),
  payload: z.record(z.unknown()),
});

export const AgentEventSchema = z.discriminatedUnion("type", [
  AgentStartSchema,
  AgentEndSchema,
  AgentErrorSchema,
  ModelEndSchema,
  ToolUseSchema,
  ToolResultSchema,
  HandoffSchema,
  AwaitingInputSchema,
  CustomEventSchema,
]);

export type AgentEvent = z.infer<typeof AgentEventSchema>;
