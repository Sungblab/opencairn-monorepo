import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  McpGetNoteInputSchema,
  McpListProjectsInputSchema,
  McpOpenAiFetchInputSchema,
  McpOpenAiSearchInputSchema,
  McpSearchNotesInputSchema,
  type McpGetNoteResult,
  type McpOpenAiFetchResult,
  type McpOpenAiSearchResult,
  type McpSearchNotesResult,
} from "@opencairn/shared";

import { publicApiBaseUrl } from "./metadata";
import { getMcpNote, listMcpProjects, searchMcpNotes } from "./search";
import { isUuid } from "../validators";

export type OpenCairnMcpAccess = {
  tokenId: string;
  workspaceId: string;
  scopes: string[];
};

export function jsonTextResult(payload: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  };
}

function noteUrl(noteId: string, sourceUrl?: string | null): string {
  if (sourceUrl) {
    try {
      return new URL(sourceUrl).toString();
    } catch {
      // Fall through to a stable OpenCairn API URL.
    }
  }
  return `${publicApiBaseUrl()}/api/notes/${noteId}`;
}

export function openAiSearchResultPayload(
  searchResult: McpSearchNotesResult,
): McpOpenAiSearchResult {
  return {
    results: searchResult.hits.map((hit) => ({
      id: hit.noteId,
      title: hit.title,
      url: noteUrl(hit.noteId, hit.sourceUrl),
      text: hit.snippet,
      metadata: {
        source: "opencairn",
        sourceType: hit.sourceType,
        projectId: hit.projectId,
        projectName: hit.projectName,
        updatedAt: hit.updatedAt,
        vectorScore: hit.vectorScore,
        bm25Score: hit.bm25Score,
        rrfScore: hit.rrfScore,
      },
    })),
  };
}

export function openAiFetchResultPayload(note: McpGetNoteResult): McpOpenAiFetchResult {
  return {
    id: note.noteId,
    title: note.title,
    url: noteUrl(note.noteId, note.sourceUrl),
    text: note.contentText,
    metadata: {
      source: "opencairn",
      sourceType: note.sourceType,
      projectId: note.projectId,
      projectName: note.projectName,
      updatedAt: note.updatedAt,
    },
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
    "search",
    {
      title: "Search",
      description:
        "OpenAI/ChatGPT-compatible alias for searching read-only OpenCairn notes.",
      inputSchema: McpOpenAiSearchInputSchema,
      annotations: { readOnlyHint: true },
    },
    async (input, extra) => {
      const access = accessFromExtra(extra);
      return jsonTextResult(
        openAiSearchResultPayload(
          await searchMcpNotes({
            workspaceId: access.workspaceId,
            query: input.query,
          }),
        ),
      );
    },
  );

  server.registerTool(
    "fetch",
    {
      title: "Fetch",
      description:
        "OpenAI/ChatGPT-compatible alias for fetching one read-only OpenCairn note by id.",
      inputSchema: McpOpenAiFetchInputSchema,
      annotations: { readOnlyHint: true },
    },
    async (input, extra) => {
      const access = accessFromExtra(extra);
      if (!isUuid(input.id)) return toolError("Document not found or not visible.");
      const note = await getMcpNote({
        workspaceId: access.workspaceId,
        noteId: input.id,
      });
      return note
        ? jsonTextResult(openAiFetchResultPayload(note))
        : toolError("Document not found or not visible.");
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
      return jsonTextResult(
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
      return note ? jsonTextResult(note) : toolError("Note not found or not visible.");
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
      return jsonTextResult(
        await listMcpProjects({
          workspaceId: access.workspaceId,
          limit: input.limit,
        }),
      );
    },
  );

  return server;
}
