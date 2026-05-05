import { describe, expect, it, vi, beforeEach } from "vitest";
import { internalRoutes } from "./internal";

const rowsQueue = vi.hoisted(() => [] as unknown[][]);

function table() {
  return new Proxy({}, { get: (_target, prop) => String(prop) });
}

function query(rows: unknown[]) {
  const chain = {
    from: () => chain,
    innerJoin: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(rows),
    orderBy: () => Promise.resolve(rows),
    then: (
      resolve: (value: unknown[]) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(rows).then(resolve, reject),
  };
  return chain;
}

vi.mock("@opencairn/db", () => {
  const t = table();
  return {
    db: {
      select: vi.fn(() => query(rowsQueue.shift() ?? [])),
    },
    user: t,
    workspaces: t,
    workspaceMembers: t,
    workspaceInvites: t,
    folders: t,
    notes: t,
    noteChunks: t,
    projects: t,
    concepts: t,
    conceptEdges: t,
    conceptNotes: t,
    wikiLogs: t,
    projectSemaphoreSlots: t,
    embeddingBatches: t,
    importJobs: t,
    researchRuns: t,
    researchRunArtifacts: t,
    codeRuns: t,
    codeTurns: t,
    suggestions: t,
    staleAlerts: t,
    audioFiles: t,
    noteEnrichments: t,
    synthesisRuns: t,
    synthesisSources: t,
    synthesisDocuments: t,
    agentRuns: t,
    agentFiles: t,
    chatMessages: t,
    chatThreads: t,
    eq: vi.fn(() => ({})),
    and: vi.fn(() => ({})),
    isNull: vi.fn(() => ({})),
    sql: vi.fn(() => ({})),
    lt: vi.fn(() => ({})),
    count: vi.fn(() => ({})),
    inArray: vi.fn(() => ({})),
    asc: vi.fn(() => ({})),
    desc: vi.fn(() => ({})),
  };
});

vi.mock("../lib/s3-get", () => ({
  streamObject: vi.fn(async () => ({
    stream: new Response("agent file body").body!,
    contentType: "text/plain; charset=utf-8",
    contentLength: 15,
  })),
}));

const workspaceId = "00000000-0000-4000-8000-000000000001";
const projectId = "00000000-0000-4000-8000-000000000002";
const userId = "user-1";

describe("internal document generation hydration route", () => {
  beforeEach(() => {
    rowsQueue.length = 0;
    process.env.INTERNAL_API_SECRET = "test-secret";
  });

  it("hydrates an agent_file source after project and file scope checks", async () => {
    rowsQueue.push(
      [{ wsId: workspaceId }],
      [{
        id: "00000000-0000-4000-8000-000000000010",
        workspaceId,
        projectId,
        title: "Generated report",
        filename: "report.md",
        kind: "markdown",
        mimeType: "text/markdown",
        objectKey: "agent-files/report.md",
        bytes: 15,
        sourceNoteId: null,
      }],
    );

    const response = await internalRoutes.request("/document-generation/hydrate-source", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-secret": "test-secret",
      },
      body: JSON.stringify({
        workspaceId,
        projectId,
        userId,
        source: {
          type: "agent_file",
          objectId: "00000000-0000-4000-8000-000000000010",
        },
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      id: "00000000-0000-4000-8000-000000000010",
      title: "Generated report",
      body: "agent file body",
      kind: "agent_file",
      objectKey: "agent-files/report.md",
      mimeType: "text/markdown",
      bytes: 15,
      included: true,
    });
  });

  it("returns binary agent_file object metadata without heavy parsing in the API", async () => {
    rowsQueue.push(
      [{ wsId: workspaceId }],
      [{
        id: "00000000-0000-4000-8000-000000000010",
        workspaceId,
        projectId,
        title: "Uploaded PDF",
        filename: "uploaded.pdf",
        kind: "pdf",
        mimeType: "application/pdf",
        objectKey: "agent-files/uploaded.pdf",
        bytes: 2048,
        sourceNoteId: null,
      }],
    );

    const response = await internalRoutes.request("/document-generation/hydrate-source", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-secret": "test-secret",
      },
      body: JSON.stringify({
        workspaceId,
        projectId,
        userId,
        source: {
          type: "agent_file",
          objectId: "00000000-0000-4000-8000-000000000010",
        },
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      id: "00000000-0000-4000-8000-000000000010",
      title: "Uploaded PDF",
      body: "uploaded.pdf (pdf, 2048 bytes)",
      kind: "agent_file",
      objectKey: "agent-files/uploaded.pdf",
      mimeType: "application/pdf",
      bytes: 2048,
      included: true,
    });
  });

  it("rejects a chat_thread source owned by another user", async () => {
    rowsQueue.push(
      [{ wsId: workspaceId }],
      [{
        id: "00000000-0000-4000-8000-000000000020",
        workspaceId,
        userId: "other-user",
        title: "Private thread",
      }],
    );

    const response = await internalRoutes.request("/document-generation/hydrate-source", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-secret": "test-secret",
      },
      body: JSON.stringify({
        workspaceId,
        projectId,
        userId,
        source: {
          type: "chat_thread",
          threadId: "00000000-0000-4000-8000-000000000020",
        },
      }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "forbidden" });
  });

  it("hydrates chat_thread content with bounded nested json extraction", async () => {
    rowsQueue.push(
      [{ wsId: workspaceId }],
      [{
        id: "00000000-0000-4000-8000-000000000020",
        workspaceId,
        userId,
        title: "Planning thread",
      }],
      [{
        id: "00000000-0000-4000-8000-000000000021",
        role: "agent",
        content: {
          children: [{
            children: [{
              children: [{
                children: [{
                  children: [{
                    children: [{
                      children: [{
                        children: [{
                          children: [{
                            children: [{
                              children: [{ body: "too deep" }],
                            }],
                          }],
                        }],
                      }],
                    }],
                  }],
                }],
              }],
            }],
          }],
        },
        createdAt: new Date("2026-05-05T00:00:00.000Z"),
      }, {
        id: "00000000-0000-4000-8000-000000000022",
        role: "user",
        content: { children: [{ text: "visible thread text" }] },
        createdAt: new Date("2026-05-05T00:01:00.000Z"),
      }],
    );

    const response = await internalRoutes.request("/document-generation/hydrate-source", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-secret": "test-secret",
      },
      body: JSON.stringify({
        workspaceId,
        projectId,
        userId,
        source: {
          type: "chat_thread",
          threadId: "00000000-0000-4000-8000-000000000020",
        },
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json() as { body: string };
    expect(body.body).toContain("visible thread text");
    expect(body.body).not.toContain("too deep");
  });

  it("rejects chat_thread hydration with too many message ids", async () => {
    rowsQueue.push([{ wsId: workspaceId }]);

    const response = await internalRoutes.request("/document-generation/hydrate-source", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-secret": "test-secret",
      },
      body: JSON.stringify({
        workspaceId,
        projectId,
        userId,
        source: {
          type: "chat_thread",
          threadId: "00000000-0000-4000-8000-000000000020",
          messageIds: Array.from(
            { length: 51 },
            (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
          ),
        },
      }),
    });

    expect(response.status).toBe(400);
  });

  it("fails closed without the internal secret", async () => {
    const response = await internalRoutes.request("/document-generation/hydrate-source", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId,
        projectId,
        userId,
        source: {
          type: "research_run",
          runId: "00000000-0000-4000-8000-000000000030",
        },
      }),
    });

    expect(response.status).toBe(401);
  });
});
