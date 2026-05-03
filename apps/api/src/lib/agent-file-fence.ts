import { z } from "zod";
import { createAgentFilePayloadSchema, type CreateAgentFilePayload } from "@opencairn/shared";

const FENCE_RE = /^[\t ]*```agent-file\s*\n([\s\S]*?)\n[\t ]*```\s*$/gm;
const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024;

const agentFileFenceSchema = z.object({
  files: z.array(createAgentFilePayloadSchema).min(1).max(5),
});

export interface AgentFileFence {
  files: CreateAgentFilePayload[];
}

export function extractAgentFileFence(text: string): AgentFileFence | null {
  let match: RegExpExecArray | null;
  let last: string | null = null;
  FENCE_RE.lastIndex = 0;
  while ((match = FENCE_RE.exec(text)) !== null) {
    last = match[1] ?? null;
  }
  if (last === null) return null;
  const trimmed = last.trim();
  if (!trimmed || Buffer.byteLength(trimmed, "utf8") > MAX_PAYLOAD_BYTES) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  const result = agentFileFenceSchema.safeParse(parsed);
  return result.success ? result.data : null;
}
