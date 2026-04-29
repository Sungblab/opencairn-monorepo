import type { ConnectorRiskLevel } from "@opencairn/shared";

export interface McpToolLike {
  name: string;
  description?: string | null;
}

function normalized(tool: McpToolLike): string {
  return `${tool.name} ${tool.description ?? ""}`
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase();
}

export function classifyMcpToolRisk(tool: McpToolLike): ConnectorRiskLevel {
  const text = normalized(tool);
  if (/\b(delete|remove|destroy|drop|archive)\b/.test(text)) {
    return "destructive";
  }
  if (/\b(send|invite|share|publish|email|notify)\b/.test(text)) {
    return "external_send";
  }
  if (/\b(create|update|write|patch|edit|comment|merge|close|open)\b/.test(text)) {
    return "write";
  }
  if (/\b(import|snapshot|ingest)\b/.test(text)) {
    return "import";
  }
  if (/\b(search|fetch|get|list|read|query|find|lookup)\b/.test(text)) {
    return "safe_read";
  }
  return "unknown";
}

export function defaultEnabledForRisk(risk: ConnectorRiskLevel): boolean {
  return risk === "safe_read";
}
