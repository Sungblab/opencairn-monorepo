import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/lib/llm/gemini", () => ({
  getGeminiProvider: vi.fn(),
}));
vi.mock("../../src/lib/internal-hybrid-search", () => ({
  projectHybridSearch: vi.fn(),
}));
vi.mock("@opencairn/db", async (orig) => {
  const real = (await orig()) as object;
  return { ...real, db: { execute: vi.fn() } };
});

const { retrieve } = await import("../../src/lib/chat-retrieval.js");
const llm = (await import("../../src/lib/llm/gemini.js")) as unknown as {
  getGeminiProvider: ReturnType<typeof vi.fn>;
};
const search = (await import("../../src/lib/internal-hybrid-search.js")) as unknown as {
  projectHybridSearch: ReturnType<typeof vi.fn>;
};

const fakeProvider = {
  embed: vi.fn().mockResolvedValue(new Array(768).fill(0)),
  streamGenerate: vi.fn(),
};

beforeEach(() => {
  llm.getGeminiProvider.mockReturnValue(fakeProvider);
  fakeProvider.embed.mockClear();
  search.projectHybridSearch.mockReset();
});

describe("chat-retrieval ragMode", () => {
  it("ragMode=off returns [] without calling embed or search", async () => {
    const hits = await retrieve({
      workspaceId: "ws-1",
      query: "anything",
      ragMode: "off",
      scope: { type: "workspace", workspaceId: "ws-1" },
      chips: [],
    });
    expect(hits).toEqual([]);
    expect(fakeProvider.embed).not.toHaveBeenCalled();
    expect(search.projectHybridSearch).not.toHaveBeenCalled();
  });

  it("ragMode=strict uses CHAT_RAG_TOP_K_STRICT (default 5)", async () => {
    const original = process.env.CHAT_RAG_TOP_K_STRICT;
    try {
      delete process.env.CHAT_RAG_TOP_K_STRICT;
      search.projectHybridSearch.mockResolvedValue([]);
      await retrieve({
        workspaceId: "ws-1",
        query: "x",
        ragMode: "strict",
        scope: { type: "project", workspaceId: "ws-1", projectId: "p-1" },
        chips: [],
      });
      expect(search.projectHybridSearch).toHaveBeenCalledWith(
        expect.objectContaining({ k: 5 }),
      );
    } finally {
      if (original === undefined) delete process.env.CHAT_RAG_TOP_K_STRICT;
      else process.env.CHAT_RAG_TOP_K_STRICT = original;
    }
  });

  it("ragMode=expand uses CHAT_RAG_TOP_K_EXPAND (default 12)", async () => {
    const original = process.env.CHAT_RAG_TOP_K_EXPAND;
    try {
      delete process.env.CHAT_RAG_TOP_K_EXPAND;
      search.projectHybridSearch.mockResolvedValue([]);
      await retrieve({
        workspaceId: "ws-1",
        query: "x",
        ragMode: "expand",
        scope: { type: "project", workspaceId: "ws-1", projectId: "p-1" },
        chips: [],
      });
      expect(search.projectHybridSearch).toHaveBeenCalledWith(
        expect.objectContaining({ k: 12 }),
      );
    } finally {
      if (original === undefined) delete process.env.CHAT_RAG_TOP_K_EXPAND;
      else process.env.CHAT_RAG_TOP_K_EXPAND = original;
    }
  });

  it("non-numeric CHAT_RAG_TOP_K_STRICT falls back to default 5", async () => {
    const original = process.env.CHAT_RAG_TOP_K_STRICT;
    try {
      process.env.CHAT_RAG_TOP_K_STRICT = "five";
      search.projectHybridSearch.mockResolvedValue([]);
      await retrieve({
        workspaceId: "ws-1",
        query: "q",
        ragMode: "strict",
        scope: { type: "project", workspaceId: "ws-1", projectId: "p-1" },
        chips: [],
      });
      expect(search.projectHybridSearch).toHaveBeenCalledWith(
        expect.objectContaining({ k: 5 }),
      );
    } finally {
      if (original === undefined) delete process.env.CHAT_RAG_TOP_K_STRICT;
      else process.env.CHAT_RAG_TOP_K_STRICT = original;
    }
  });
});

describe("chat-retrieval chip union", () => {
  let dbMod: { db: { execute: ReturnType<typeof vi.fn> } };
  beforeEach(async () => {
    dbMod = (await import("@opencairn/db")) as unknown as typeof dbMod;
    dbMod.db.execute.mockReset();
    search.projectHybridSearch.mockReset();
    search.projectHybridSearch.mockResolvedValue([]);
  });

  it("project chip in same workspace is included", async () => {
    dbMod.db.execute.mockResolvedValue({ rows: [{}] }); // projectInWorkspace → true
    await retrieve({
      workspaceId: "ws-1",
      query: "q",
      ragMode: "strict",
      scope: { type: "workspace", workspaceId: "ws-1" },
      chips: [{ type: "project", id: "p-allowed" }],
    });
    expect(search.projectHybridSearch).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "p-allowed" }),
    );
  });

  it("project chip in different workspace is silently dropped", async () => {
    dbMod.db.execute.mockResolvedValue({ rows: [] }); // projectInWorkspace → false
    await retrieve({
      workspaceId: "ws-1",
      query: "q",
      ragMode: "strict",
      scope: { type: "workspace", workspaceId: "ws-1" },
      chips: [{ type: "project", id: "p-other-ws" }],
    });
    expect(search.projectHybridSearch).not.toHaveBeenCalled();
  });

  it("when chips are non-empty, conversation scope is ignored", async () => {
    dbMod.db.execute.mockResolvedValue({ rows: [{}] });
    await retrieve({
      workspaceId: "ws-1",
      query: "q",
      ragMode: "strict",
      scope: { type: "project", workspaceId: "ws-1", projectId: "p-conv" },
      chips: [{ type: "project", id: "p-chip" }],
    });
    const calls = search.projectHybridSearch.mock.calls.map(
      (c) => (c[0] as { projectId: string }).projectId,
    );
    expect(calls).toEqual(["p-chip"]);
  });

  it("workspace chip with matching id expands to all projects in workspace", async () => {
    // First db.execute call: allProjectsInWorkspace returns 2 projects
    dbMod.db.execute.mockResolvedValueOnce({
      rows: [{ id: "p-a" }, { id: "p-b" }],
    });
    await retrieve({
      workspaceId: "ws-1",
      query: "q",
      ragMode: "strict",
      scope: { type: "workspace", workspaceId: "ws-1" },
      chips: [{ type: "workspace", id: "ws-1" }],
    });
    const calls = search.projectHybridSearch.mock.calls.map(
      (c) => (c[0] as { projectId: string }).projectId,
    );
    expect(calls.sort()).toEqual(["p-a", "p-b"]);
  });

  it("workspace chip with foreign id is silently dropped (no DB call, no search)", async () => {
    await retrieve({
      workspaceId: "ws-1",
      query: "q",
      ragMode: "strict",
      scope: { type: "workspace", workspaceId: "ws-1" },
      chips: [{ type: "workspace", id: "ws-other" }],
    });
    expect(dbMod.db.execute).not.toHaveBeenCalled();
    expect(search.projectHybridSearch).not.toHaveBeenCalled();
  });

  it("page chip pointing at note in different workspace is silently dropped", async () => {
    // projectIdForNote returns no rows because the JOIN's workspace_id filter excludes it
    dbMod.db.execute.mockResolvedValue({ rows: [] });
    await retrieve({
      workspaceId: "ws-1",
      query: "q",
      ragMode: "strict",
      scope: { type: "workspace", workspaceId: "ws-1" },
      chips: [{ type: "page", id: "n-foreign" }],
    });
    expect(search.projectHybridSearch).not.toHaveBeenCalled();
  });
});

describe("chat-retrieval fanout concurrency", () => {
  let dbMod: { db: { execute: ReturnType<typeof vi.fn> } };
  beforeEach(async () => {
    dbMod = (await import("@opencairn/db")) as unknown as typeof dbMod;
    dbMod.db.execute.mockReset();
    search.projectHybridSearch.mockReset();
  });

  it("caps in-flight projectHybridSearch calls at CHAT_RAG_FANOUT_CONCURRENCY", async () => {
    const original = process.env.CHAT_RAG_FANOUT_CONCURRENCY;
    try {
      process.env.CHAT_RAG_FANOUT_CONCURRENCY = "3";
      // Workspace expansion → 20 projects.
      const projects = Array.from({ length: 20 }, (_, i) => ({ id: `p-${i}` }));
      dbMod.db.execute.mockResolvedValueOnce({ rows: projects });

      let inflight = 0;
      let maxInflight = 0;
      search.projectHybridSearch.mockImplementation(async () => {
        inflight += 1;
        if (inflight > maxInflight) maxInflight = inflight;
        // Yield to the event loop so the worker pool actually has a chance
        // to schedule competing fns; without this, the synchronous mock
        // resolves before the next worker even picks up its task.
        await new Promise((r) => setTimeout(r, 5));
        inflight -= 1;
        return [];
      });

      await retrieve({
        workspaceId: "ws-1",
        query: "q",
        ragMode: "strict",
        scope: { type: "workspace", workspaceId: "ws-1" },
        chips: [],
      });

      expect(search.projectHybridSearch).toHaveBeenCalledTimes(20);
      expect(maxInflight).toBeGreaterThan(0);
      expect(maxInflight).toBeLessThanOrEqual(3);
    } finally {
      if (original === undefined) delete process.env.CHAT_RAG_FANOUT_CONCURRENCY;
      else process.env.CHAT_RAG_FANOUT_CONCURRENCY = original;
    }
  });
});

describe("chat-retrieval abort signal", () => {
  beforeEach(() => {
    search.projectHybridSearch.mockReset();
    search.projectHybridSearch.mockResolvedValue([]);
  });

  it("pre-aborted signal short-circuits before any projectHybridSearch call", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(
      retrieve({
        workspaceId: "ws-1",
        query: "q",
        ragMode: "strict",
        scope: { type: "project", workspaceId: "ws-1", projectId: "p-1" },
        chips: [],
        signal: ctrl.signal,
      }),
    ).rejects.toThrow(/abort/i);
    expect(search.projectHybridSearch).not.toHaveBeenCalled();
  });
});
