import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  McpGetNoteInputSchema,
  McpListProjectsInputSchema,
  McpSearchNotesInputSchema,
} from "@opencairn/shared";

import { getMcpNote, listMcpProjects, searchMcpNotes } from "./search";

export type OpenCairnMcpAccess = {
  tokenId: string;
  workspaceId: string;
  scopes: string[];
};

function result(payload: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  };
}

function toolError(message: string): CallToolResult {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

function accessFromExtra(extra: { authInfo?: { extra?: Record<string, unknown> } }): OpenCairnMcpAccess {
  const access = extra.authInfo?.extra?.opencairnAccess as OpenCairnMcpAccess | undefined;
  if (!access?.workspaceId || !access.scopes.includes("workspace:read")) {
    throw new Error("missing MCP access context");
  }
  return access;
}

export function createOpenCairnMcpServer(): McpServer {
  const server = new McpServer(
    {
      name: "opencairn",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  server.registerTool(
    "search_notes",
    {
      title: "Search notes",
      description: "Search read-only OpenCairn notes in the token workspace.",
      inputSchema: McpSearchNotesInputSchema,
      annotations: { readOnlyHint: true },
    },
    async (input, extra) => {
      const access = accessFromExtra(extra);
      return result(
        await searchMcpNotes({
          workspaceId: access.workspaceId,
          query: input.query,
          limit: input.limit,
          projectId: input.projectId,
        }),
      );
    },
  );

  server.registerTool(
    "get_note",
    {
      title: "Get note",
      description: "Fetch one read-only OpenCairn note by id.",
      inputSchema: McpGetNoteInputSchema,
      annotations: { readOnlyHint: true },
    },
    async (input, extra) => {
      const access = accessFromExtra(extra);
      const note = await getMcpNote({
        workspaceId: access.workspaceId,
        noteId: input.noteId,
      });
      return note ? result(note) : toolError("Note not found or not visible.");
    },
  );

  server.registerTool(
    "list_projects",
    {
      title: "List projects",
      description: "List projects in the token workspace.",
      inputSchema: McpListProjectsInputSchema,
      annotations: { readOnlyHint: true },
    },
    async (input, extra) => {
      const access = accessFromExtra(extra);
      return result(
        await listMcpProjects({
          workspaceId: access.workspaceId,
          limit: input.limit,
        }),
      );
    },
  );

  return server;
}
