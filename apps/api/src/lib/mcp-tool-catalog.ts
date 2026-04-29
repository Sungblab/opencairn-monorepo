import { connectorMcpTools, db } from "@opencairn/db";

import { classifyMcpToolRisk, defaultEnabledForRisk } from "./mcp-tool-risk";

export interface McpCatalogTool {
  name: string;
  description?: string | null;
  inputSchema?: Record<string, unknown>;
  input_schema?: Record<string, unknown>;
}

export async function upsertMcpToolCatalog(
  sourceId: string,
  tools: McpCatalogTool[],
): Promise<void> {
  const seenAt = new Date();
  for (const tool of tools) {
    const riskLevel = classifyMcpToolRisk(tool);
    await db
      .insert(connectorMcpTools)
      .values({
        sourceId,
        toolName: tool.name,
        description: tool.description ?? null,
        inputSchema: tool.inputSchema ?? tool.input_schema ?? {},
        riskLevel,
        enabled: defaultEnabledForRisk(riskLevel),
        lastSeenAt: seenAt,
      })
      .onConflictDoUpdate({
        target: [connectorMcpTools.sourceId, connectorMcpTools.toolName],
        set: {
          description: tool.description ?? null,
          inputSchema: tool.inputSchema ?? tool.input_schema ?? {},
          riskLevel,
          enabled: defaultEnabledForRisk(riskLevel),
          lastSeenAt: seenAt,
          updatedAt: seenAt,
        },
      });
  }
}
