import { createHash } from "node:crypto";

const VOLATILE_KEYS = new Set([
  "updatedAt",
  "createdAt",
  "selection",
  "cursor",
  "awareness",
]);

export function canonicalizeForHash(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalizeForHash);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};

  for (const key of Object.keys(input).sort()) {
    if (VOLATILE_KEYS.has(key)) {
      continue;
    }
    output[key] = canonicalizeForHash(input[key]);
  }

  return output;
}

export function stableJson(value: unknown): string {
  return JSON.stringify(canonicalizeForHash(value));
}

export function contentHash(input: {
  title: string;
  content: unknown;
}): string {
  return createHash("sha256")
    .update(stableJson({ title: input.title, content: input.content }))
    .digest("hex");
}

export function previewText(text: string, max = 120): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, max - 3))}...`;
}
