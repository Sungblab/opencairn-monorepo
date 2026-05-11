import { z } from "zod";
import { createAgentActionRequestSchema } from "./agent-actions";

const FENCE_RE = /^[\t ]*```agent-actions\s*\n([\s\S]*?)\n[\t ]*```\s*$/gm;
const MAX_PAYLOAD_BYTES = 256 * 1024;
const encoder = new TextEncoder();

const agentActionFenceSchema = z.object({
  actions: z.array(createAgentActionRequestSchema).min(1).max(10),
});

export type AgentActionFence = z.infer<typeof agentActionFenceSchema>;

export function extractAgentActionFence(text: string): AgentActionFence | null {
  let match: RegExpExecArray | null;
  let last: string | null = null;
  FENCE_RE.lastIndex = 0;
  while ((match = FENCE_RE.exec(text)) !== null) {
    last = match[1] ?? null;
  }
  if (last === null) return null;

  const trimmed = last.trim();
  if (!trimmed || encoder.encode(trimmed).byteLength > MAX_PAYLOAD_BYTES) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  const result = agentActionFenceSchema.safeParse(parsed);
  return result.success ? result.data : null;
}
