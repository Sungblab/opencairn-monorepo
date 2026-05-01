import { describe, expect, it } from "vitest";

import {
  createOpenCairnMcpServer,
  jsonTextResult,
  openAiFetchResultPayload,
  openAiSearchResultPayload,
} from "../../src/lib/mcp-server/server";

function registeredToolNames(server: unknown): string[] {
  const candidate = server as {
    _registeredTools?: Record<string, unknown>;
    registeredTools?: Record<string, unknown>;
    _tools?: Record<string, unknown>;
  };
  return Object.keys(
    candidate._registeredTools ?? candidate.registeredTools ?? candidate._tools ?? {},
  ).sort();
}

describe("OpenCairn MCP server registration", () => {
  it("keeps legacy tools and exposes OpenAI-compatible search/fetch aliases", () => {
    const names = registeredToolNames(createOpenCairnMcpServer());
    expect(names).toEqual(
      expect.arrayContaining(["fetch", "get_note", "list_projects", "search", "search_notes"]),
    );
  });

  it("formats search alias output as JSON text-compatible data", () => {
    const payload = openAiSearchResultPayload({
      hits: [
        {
          noteId: "11111111-1111-4111-8111-111111111111",
          title: "Interop note",
          projectId: "22222222-2222-4222-8222-222222222222",
          projectName: "Research",
          snippet: "OpenCairn MCP search result",
          sourceType: "document",
          sourceUrl: null,
          updatedAt: "2026-05-01T00:00:00.000Z",
          vectorScore: null,
          bm25Score: 0.5,
          rrfScore: 0.1,
        },
      ],
    });
    const parsed = JSON.parse(JSON.stringify(payload)) as typeof payload;
    expect(parsed.results[0]).toMatchObject({
      id: "11111111-1111-4111-8111-111111111111",
      title: "Interop note",
      text: "OpenCairn MCP search result",
      metadata: {
        source: "opencairn",
        projectName: "Research",
      },
    });
    expect(parsed.results[0]?.url).toContain("/api/notes/11111111-1111-4111-8111-111111111111");
  });

  it("returns OpenAI-compatible payloads as JSON text content", () => {
    const result = jsonTextResult({
      results: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          title: "Interop note",
          text: "OpenCairn MCP search result",
        },
      ],
    });
    expect(result.content).toHaveLength(1);
    expect(result.content[0]?.type).toBe("text");
    expect(JSON.parse(result.content[0]?.text ?? "{}")).toMatchObject({
      results: [{ title: "Interop note" }],
    });
  });

  it("formats fetch alias output without flattening note text", () => {
    const payload = openAiFetchResultPayload({
      noteId: "11111111-1111-4111-8111-111111111111",
      title: "Formatted note",
      projectId: "22222222-2222-4222-8222-222222222222",
      projectName: "Research",
      sourceType: "document",
      sourceUrl: null,
      contentText: "Heading\n\n- preserve lists\n\n```ts\nconst ok = true;\n```",
      updatedAt: "2026-05-01T00:00:00.000Z",
    });
    const parsed = JSON.parse(JSON.stringify(payload)) as typeof payload;
    expect(parsed).toMatchObject({
      id: "11111111-1111-4111-8111-111111111111",
      title: "Formatted note",
      metadata: {
        source: "opencairn",
        projectName: "Research",
      },
    });
    expect(parsed.text).toContain("\n\n- preserve lists\n\n```ts");
  });
});
