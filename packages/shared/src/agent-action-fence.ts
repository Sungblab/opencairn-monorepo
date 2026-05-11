import { z } from "zod";
import { createAgentActionRequestSchema } from "./agent-actions";

const MAX_PAYLOAD_BYTES = 256 * 1024;
const encoder = new TextEncoder();

const agentActionFenceSchema = z.object({
  actions: z.array(createAgentActionRequestSchema).min(1).max(10),
});

export type AgentActionFence = z.infer<typeof agentActionFenceSchema>;

export function extractAgentActionFence(text: string): AgentActionFence | null {
  let last: string | null = null;
  let start: number | null = null;
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim();
    if (line === "```agent-actions") {
      start = index + 1;
      continue;
    }
    if (line === "```" && start !== null) {
      last = lines.slice(start, index).join("\n");
      start = null;
    }
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
