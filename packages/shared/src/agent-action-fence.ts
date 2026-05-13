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

  const parsed = parseAgentActionJson(trimmed);
  if (!parsed.ok) {
    return null;
  }

  const result = agentActionFenceSchema.safeParse(parsed.value);
  return result.success ? result.data : null;
}

function parseAgentActionJson(
  text: string,
): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    for (const repaired of repairCommonTrailingJsonTruncations(text)) {
      if (repaired === text) continue;
      try {
        return { ok: true, value: JSON.parse(repaired) };
      } catch {
        // Try the next conservative repair.
      }
    }
    return { ok: false };
  }
}

function repairCommonTrailingJsonTruncations(text: string): string[] {
  const repairs = [
    repairMissingTrailingObjectBraces(text),
    repairMissingTrailingActionsArrayBracket(text),
  ];
  return [...new Set(repairs)];
}

function repairMissingTrailingObjectBraces(text: string): string {
  let objectDepth = 0;
  let arrayDepth = 0;
  let inString = false;
  let escaped = false;

  for (const char of text) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = inString;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === "{") objectDepth += 1;
    else if (char === "}") objectDepth -= 1;
    else if (char === "[") arrayDepth += 1;
    else if (char === "]") arrayDepth -= 1;

    if (objectDepth < 0 || arrayDepth < 0) return text;
  }

  if (inString || arrayDepth !== 0 || objectDepth < 1 || objectDepth > 2) {
    return text;
  }
  return `${text}${"}".repeat(objectDepth)}`;
}

function repairMissingTrailingActionsArrayBracket(text: string): string {
  let objectDepth = 0;
  let arrayDepth = 0;
  let inString = false;
  let escaped = false;

  for (const char of text) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = inString;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === "{") objectDepth += 1;
    else if (char === "}") objectDepth -= 1;
    else if (char === "[") arrayDepth += 1;
    else if (char === "]") arrayDepth -= 1;

    if (objectDepth < 0 || arrayDepth < 0) return text;
  }

  if (inString || objectDepth !== 0 || arrayDepth !== 1) return text;

  const lastBrace = text.lastIndexOf("}");
  if (lastBrace === -1) return text;
  return `${text.slice(0, lastBrace)}]${text.slice(lastBrace)}`;
}
