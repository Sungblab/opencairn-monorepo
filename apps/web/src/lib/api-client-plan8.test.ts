import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { plan8AgentsApi } from "./api-client";

describe("plan8AgentsApi", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify({ workflowId: "wf-1" }), {
        status: 202,
        headers: { "content-type": "application/json" },
      }),
    );
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("loads overview with encoded projectId", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          project: { id: "project/1", workspaceId: "workspace-1" },
          launch: { notes: [], concepts: [] },
          agentRuns: [],
          suggestions: [],
          staleAlerts: [],
          audioFiles: [],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    await plan8AgentsApi.overview("project/1");

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(
      "http://localhost:4000/api/agents/plan8/overview?projectId=project%2F1",
    );
    expect(init).toEqual(
      expect.objectContaining({
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      }),
    );
  });

  it("posts synthesis launch body", async () => {
    await plan8AgentsApi.runSynthesis({
      projectId: "project-1",
      noteIds: ["note-1", "note-2"],
      title: "종합 노트",
    });

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("http://localhost:4000/api/synthesis/run");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({
      projectId: "project-1",
      noteIds: ["note-1", "note-2"],
      title: "종합 노트",
    });
  });

  it("posts librarian, connector, staleness, and narrator launch bodies", async () => {
    await plan8AgentsApi.runLibrarian({ projectId: "project-1" });
    await plan8AgentsApi.runConnector({
      projectId: "project-1",
      conceptId: "concept-1",
    });
    await plan8AgentsApi.runStaleness({ projectId: "project-1" });
    await plan8AgentsApi.runNarrator({ noteId: "note-1" });

    expect(fetchSpy.mock.calls[0][0]).toBe(
      "http://localhost:4000/api/librarian/run",
    );
    expect(JSON.parse(fetchSpy.mock.calls[0][1]?.body as string)).toEqual({
      projectId: "project-1",
    });
    expect(fetchSpy.mock.calls[1][0]).toBe(
      "http://localhost:4000/api/connector/run",
    );
    expect(JSON.parse(fetchSpy.mock.calls[1][1]?.body as string)).toEqual({
      projectId: "project-1",
      conceptId: "concept-1",
    });
    expect(fetchSpy.mock.calls[2][0]).toBe(
      "http://localhost:4000/api/agents/temporal/stale-check",
    );
    expect(JSON.parse(fetchSpy.mock.calls[2][1]?.body as string)).toEqual({
      projectId: "project-1",
    });
    expect(fetchSpy.mock.calls[3][0]).toBe(
      "http://localhost:4000/api/narrator/run",
    );
    expect(JSON.parse(fetchSpy.mock.calls[3][1]?.body as string)).toEqual({
      noteId: "note-1",
    });
  });

  it("patches suggestion status", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, status: "accepted" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await plan8AgentsApi.resolveSuggestion("suggestion/1", "accepted");

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(
      "http://localhost:4000/api/agents/plan8/suggestions/suggestion%2F1",
    );
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(init?.body as string)).toEqual({ status: "accepted" });
  });

  it("marks stale alerts reviewed", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await plan8AgentsApi.reviewStaleAlert("stale/1");

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(
      "http://localhost:4000/api/agents/plan8/stale-alerts/stale%2F1/review",
    );
    expect(init?.method).toBe("PATCH");
  });
});
