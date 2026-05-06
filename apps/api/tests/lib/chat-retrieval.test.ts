import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/lib/llm/gemini", () => ({
  getGeminiProvider: vi.fn(),
}));
vi.mock("../../src/lib/internal-hybrid-search", () => ({
  projectHybridSearch: vi.fn(),
}));
vi.mock("../../src/lib/chunk-hybrid-search", () => ({
  projectChunkHybridSearch: vi.fn(),
}));
vi.mock("../../src/lib/retrieval-graph-expansion", () => ({
  expandGraphCandidates: vi.fn(),
}));
vi.mock("@opencairn/db", async (orig) => {
  const real = (await orig()) as object;
  return { ...real, db: { execute: vi.fn() } };
});

const { retrieve, retrieveWithPolicy } =
  await import("../../src/lib/chat-retrieval.js");
const llm = (await import("../../src/lib/llm/gemini.js")) as unknown as {
  getGeminiProvider: ReturnType<typeof vi.fn>;
};
const search =
  (await import("../../src/lib/internal-hybrid-search.js")) as unknown as {
    projectHybridSearch: ReturnType<typeof vi.fn>;
  };
const chunkSearch =
  (await import("../../src/lib/chunk-hybrid-search.js")) as unknown as {
    projectChunkHybridSearch: ReturnType<typeof vi.fn>;
  };
const graphExpansion =
  (await import("../../src/lib/retrieval-graph-expansion.js")) as unknown as {
    expandGraphCandidates: ReturnType<typeof vi.fn>;
  };

const fakeProvider = {
  embed: vi.fn().mockResolvedValue(new Array(768).fill(0)),
  streamGenerate: vi.fn(),
};

beforeEach(() => {
  llm.getGeminiProvider.mockReturnValue(fakeProvider);
  fakeProvider.embed.mockClear();
  fakeProvider.streamGenerate.mockReset();
  search.projectHybridSearch.mockReset();
  chunkSearch.projectChunkHybridSearch.mockReset();
  chunkSearch.projectChunkHybridSearch.mockResolvedValue([]);
  graphExpansion.expandGraphCandidates.mockReset();
  graphExpansion.expandGraphCandidates.mockResolvedValue([]);
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
    expect(chunkSearch.projectChunkHybridSearch).not.toHaveBeenCalled();
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
    chunkSearch.projectChunkHybridSearch.mockReset();
    chunkSearch.projectChunkHybridSearch.mockResolvedValue([]);
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
    chunkSearch.projectChunkHybridSearch.mockReset();
    chunkSearch.projectChunkHybridSearch.mockResolvedValue([]);
  });

  it("caps in-flight project search calls at CHAT_RAG_FANOUT_CONCURRENCY", async () => {
    const original = process.env.CHAT_RAG_FANOUT_CONCURRENCY;
    try {
      process.env.CHAT_RAG_FANOUT_CONCURRENCY = "3";
      // Workspace expansion → 20 projects.
      const projects = Array.from({ length: 20 }, (_, i) => ({ id: `p-${i}` }));
      dbMod.db.execute.mockResolvedValueOnce({ rows: projects });

      let inflight = 0;
      let maxInflight = 0;
      chunkSearch.projectChunkHybridSearch.mockImplementation(async () => {
        inflight += 1;
        if (inflight > maxInflight) maxInflight = inflight;
        // Yield to the event loop so the worker pool actually has a chance
        // to schedule competing fns; without this, the synchronous mock
        // resolves before the next worker even picks up its task.
        await new Promise((r) => setTimeout(r, 5));
        inflight -= 1;
        return [];
      });
      search.projectHybridSearch.mockResolvedValue([]);

      await retrieve({
        workspaceId: "ws-1",
        query: "q",
        ragMode: "strict",
        scope: { type: "workspace", workspaceId: "ws-1" },
        chips: [],
      });

      expect(chunkSearch.projectChunkHybridSearch).toHaveBeenCalledTimes(20);
      expect(search.projectHybridSearch).toHaveBeenCalledTimes(20);
      expect(maxInflight).toBeGreaterThan(0);
      expect(maxInflight).toBeLessThanOrEqual(3);
    } finally {
      if (original === undefined)
        delete process.env.CHAT_RAG_FANOUT_CONCURRENCY;
      else process.env.CHAT_RAG_FANOUT_CONCURRENCY = original;
    }
  });
});

describe("chat-retrieval abort signal", () => {
  beforeEach(() => {
    search.projectHybridSearch.mockReset();
    search.projectHybridSearch.mockResolvedValue([]);
    chunkSearch.projectChunkHybridSearch.mockReset();
    chunkSearch.projectChunkHybridSearch.mockResolvedValue([]);
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
    expect(chunkSearch.projectChunkHybridSearch).not.toHaveBeenCalled();
  });
});

describe("chat-retrieval chunk fallback", () => {
  it("prefers chunk hits before falling back to note hits", async () => {
    chunkSearch.projectChunkHybridSearch.mockResolvedValue([
      {
        chunkId: "c1",
        noteId: "n1",
        title: "Chunked",
        headingPath: "Intro",
        snippet: "chunk hit",
        rrfScore: 1,
        vectorScore: 0.9,
        bm25Score: null,
      },
    ]);

    const hits = await retrieve({
      workspaceId: "ws1",
      query: "alpha",
      ragMode: "strict",
      scope: { type: "project", workspaceId: "ws1", projectId: "p1" },
      chips: [],
    });

    expect(hits[0]).toMatchObject({
      noteId: "n1",
      chunkId: "c1",
      title: "Chunked",
      headingPath: "Intro",
      snippet: "chunk hit",
      evidenceId: "chunk:c1",
      provenance: "extracted",
    });
    expect(search.projectHybridSearch).not.toHaveBeenCalled();
  });

  it("falls back to note hits when a project has no chunk hits", async () => {
    chunkSearch.projectChunkHybridSearch.mockResolvedValue([]);
    search.projectHybridSearch.mockResolvedValue([
      {
        noteId: "n2",
        title: "Fallback",
        snippet: "note hit",
        sourceType: null,
        sourceUrl: null,
        vectorScore: null,
        bm25Score: 0.7,
        rrfScore: 0.5,
      },
    ]);

    const hits = await retrieve({
      workspaceId: "ws1",
      query: "alpha",
      ragMode: "strict",
      scope: { type: "project", workspaceId: "ws1", projectId: "p1" },
      chips: [],
    });

    expect(hits[0]).toMatchObject({
      noteId: "n2",
      title: "Fallback",
      snippet: "note hit",
    });
  });

  it("adds graph expansion candidates in expand mode through the candidate pipeline", async () => {
    chunkSearch.projectChunkHybridSearch.mockResolvedValue([
      {
        chunkId: "c1",
        noteId: "n1",
        title: "Seed",
        headingPath: "Intro",
        snippet: "seed alpha",
        rrfScore: 1,
        vectorScore: 0.9,
        bm25Score: null,
      },
    ]);
    graphExpansion.expandGraphCandidates.mockResolvedValue([
      {
        chunkId: "c2",
        noteId: "n2",
        title: "Related",
        headingPath: "Graph",
        snippet: "related alpha",
        graphScore: 0.8,
        sourceType: "manual",
        sourceUrl: null,
        updatedAt: "2026-05-03T00:00:00.000Z",
      },
    ]);

    const hits = await retrieve({
      workspaceId: "ws1",
      query: "alpha 관련 문서 연결 흐름",
      ragMode: "expand",
      scope: { type: "project", workspaceId: "ws1", projectId: "p1" },
      chips: [],
    });

    expect(hits.map((h) => h.noteId)).toContain("n2");
    expect(hits.find((h) => h.noteId === "n2")).toMatchObject({
      chunkId: "c2",
      channelScores: { graph: 0.8 },
      evidenceId: "graph:chunk:c2",
      provenance: "inferred",
      producer: { kind: "api", tool: "retrieval-graph-expansion" },
      support: "mentions",
    });
    expect(graphExpansion.expandGraphCandidates).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws1",
        projectId: "p1",
        seedNoteIds: ["n1"],
        maxDepth: 2,
      }),
    );
  });

  it("skips graph expansion for simple expand-mode lookups", async () => {
    chunkSearch.projectChunkHybridSearch.mockResolvedValue([
      {
        chunkId: "c-simple",
        noteId: "n-simple",
        title: "Simple",
        headingPath: "Intro",
        snippet: "simple alpha",
        rrfScore: 1,
        vectorScore: 0.9,
        bm25Score: null,
      },
    ]);

    const hits = await retrieve({
      workspaceId: "ws1",
      query: "alpha 정의",
      ragMode: "expand",
      scope: { type: "project", workspaceId: "ws1", projectId: "p1" },
      chips: [],
    });

    expect(hits.map((h) => h.noteId)).toEqual(["n-simple"]);
    expect(graphExpansion.expandGraphCandidates).not.toHaveBeenCalled();
  });

  it("runs one corrective graph retry for sparse expand-mode evidence", async () => {
    chunkSearch.projectChunkHybridSearch.mockResolvedValue([
      chunkHit("sparse-1", "note-1", 0.25),
    ]);
    graphExpansion.expandGraphCandidates.mockResolvedValue([
      {
        noteId: "note-2",
        chunkId: "chunk-2",
        title: "Related path",
        headingPath: "Impact",
        snippet: "relationship evidence",
        graphScore: 0.9,
        sourceType: null,
        sourceUrl: null,
        updatedAt: null,
      },
    ]);

    const result = await retrieveWithPolicy({
      workspaceId: "ws-1",
      query: "alpha 정의",
      ragMode: "expand",
      scope: { type: "project", workspaceId: "ws-1", projectId: "p-1" },
      chips: [],
    });

    expect(graphExpansion.expandGraphCandidates).toHaveBeenCalledWith(
      expect.objectContaining({ maxDepth: 1 }),
    );
    expect(result.policy.reasons).toContain("corrective_retry");
    expect(result.qualityReport.decision).toBe("sparse");
    expect(result.hits.map((hit) => hit.noteId)).toContain("note-2");
  });
});

describe("retrieveWithPolicy adaptive policy propagation", () => {
  let dbMod: { db: { execute: ReturnType<typeof vi.fn> } };

  beforeEach(async () => {
    dbMod = (await import("@opencairn/db")) as unknown as typeof dbMod;
    dbMod.db.execute.mockReset();
    search.projectHybridSearch.mockReset();
    chunkSearch.projectChunkHybridSearch.mockReset();
    graphExpansion.expandGraphCandidates.mockReset();
    chunkSearch.projectChunkHybridSearch.mockResolvedValue([
      {
        chunkId: "c-seed",
        noteId: "n-seed",
        title: "Seed alpha",
        headingPath: "Intro",
        snippet: "seed alpha relationship",
        rrfScore: 1,
        vectorScore: 0.9,
        bm25Score: null,
      },
    ]);
    graphExpansion.expandGraphCandidates.mockResolvedValue([
      {
        chunkId: "c-graph",
        noteId: "n-graph",
        title: "Graph alpha",
        headingPath: "Related",
        snippet: "graph alpha relationship",
        graphScore: 0.8,
        sourceType: "manual",
        sourceUrl: null,
        updatedAt: "2026-05-03T00:00:00.000Z",
      },
    ]);
  });

  it("passes seedTopK, graphDepth, and graphLimit into retrieval and graph expansion", async () => {
    const env = {
      deepSeed: process.env.CHAT_RAG_ADAPTIVE_DEEP_SEED_K,
      deepLimit: process.env.CHAT_RAG_ADAPTIVE_DEEP_GRAPH_LIMIT,
    };
    try {
      process.env.CHAT_RAG_ADAPTIVE_DEEP_SEED_K = "21";
      process.env.CHAT_RAG_ADAPTIVE_DEEP_GRAPH_LIMIT = "34";

      const result = await retrieveWithPolicy({
        workspaceId: "ws-1",
        query: "alpha가 beta와 어떤 관계로 연결되는지 알려줘",
        ragMode: "expand",
        scope: { type: "project", workspaceId: "ws-1", projectId: "p-1" },
        chips: [],
      });

      expect(result.policy).toMatchObject({
        seedTopK: 21,
        graphDepth: 2,
        graphLimit: 34,
      });
      expect(result.policySummary).toMatchObject({
        route: "relationship",
        retrievalShape: {
          seedTopK: 21,
          graphDepth: 2,
          graphLimit: 34,
        },
      });
      expect(chunkSearch.projectChunkHybridSearch).toHaveBeenCalledWith(
        expect.objectContaining({
          k: 21,
          policy: expect.objectContaining({ seedTopK: 21, graphDepth: 2 }),
        }),
      );
      expect(graphExpansion.expandGraphCandidates).toHaveBeenCalledWith(
        expect.objectContaining({
          maxDepth: 2,
          limit: 34,
          seedNoteIds: ["n-seed"],
        }),
      );
    } finally {
      if (env.deepSeed === undefined)
        delete process.env.CHAT_RAG_ADAPTIVE_DEEP_SEED_K;
      else process.env.CHAT_RAG_ADAPTIVE_DEEP_SEED_K = env.deepSeed;
      if (env.deepLimit === undefined)
        delete process.env.CHAT_RAG_ADAPTIVE_DEEP_GRAPH_LIMIT;
      else process.env.CHAT_RAG_ADAPTIVE_DEEP_GRAPH_LIMIT = env.deepLimit;
    }
  });

  it("replans workspace fanout after resolving project count and exposes context packing limits", async () => {
    const env = {
      context: process.env.CHAT_RAG_ADAPTIVE_CONTEXT_TOKENS,
    };
    try {
      process.env.CHAT_RAG_ADAPTIVE_CONTEXT_TOKENS = "4321";
      dbMod.db.execute.mockResolvedValueOnce({
        rows: [{ id: "p-a" }, { id: "p-b" }],
      });

      const result = await retrieveWithPolicy({
        workspaceId: "ws-1",
        query: "workspace 전체에서 alpha 근거 정리해줘",
        ragMode: "expand",
        scope: { type: "workspace", workspaceId: "ws-1" },
        chips: [],
      });

      expect(result.policy.reasons).toEqual(
        expect.arrayContaining(["research_depth", "workspace_fanout"]),
      );
      expect(result.policy.contextMaxTokens).toBe(4321);
      expect(result.policy.maxChunksPerNote).toBe(1);
      expect(chunkSearch.projectChunkHybridSearch).toHaveBeenCalledTimes(2);
    } finally {
      if (env.context === undefined)
        delete process.env.CHAT_RAG_ADAPTIVE_CONTEXT_TOKENS;
      else process.env.CHAT_RAG_ADAPTIVE_CONTEXT_TOKENS = env.context;
    }
  });

  it("spreads workspace fanout hits by project before resultTopK truncation", async () => {
    const env = {
      topK: process.env.CHAT_RAG_TOP_K_EXPAND,
    };
    try {
      process.env.CHAT_RAG_TOP_K_EXPAND = "3";
      dbMod.db.execute.mockResolvedValueOnce({
        rows: [{ id: "p-hot" }, { id: "p-cold" }],
      });
      chunkSearch.projectChunkHybridSearch.mockImplementation(
        async (opts: { projectId: string }) => {
          if (opts.projectId === "p-hot") {
            return [
              chunkHit("hot-1", "hot-note-1", 0.99),
              chunkHit("hot-2", "hot-note-2", 0.98),
              chunkHit("hot-3", "hot-note-3", 0.97),
            ];
          }
          return [chunkHit("cold-1", "cold-note-1", 0.72)];
        },
      );

      const result = await retrieveWithPolicy({
        workspaceId: "ws-1",
        query: "workspace 전체에서 alpha 근거 정리해줘",
        ragMode: "expand",
        scope: { type: "workspace", workspaceId: "ws-1" },
        chips: [],
      });

      expect(result.policySummary.route).toBe("workspace_fanout");
      expect(result.hits.map((hit) => hit.noteId)).toEqual([
        "hot-note-1",
        "cold-note-1",
        "hot-note-2",
      ]);
      expect(result.hits.map((hit) => hit.projectId)).toEqual([
        "p-hot",
        "p-cold",
        "p-hot",
      ]);
    } finally {
      if (env.topK === undefined) delete process.env.CHAT_RAG_TOP_K_EXPAND;
      else process.env.CHAT_RAG_TOP_K_EXPAND = env.topK;
    }
  });
});

describe("chat-retrieval provider reranker", () => {
  it("uses provider reranking when explicitly enabled", async () => {
    const env = process.env.CHAT_RAG_RERANKER;
    try {
      process.env.CHAT_RAG_RERANKER = "provider";
      chunkSearch.projectChunkHybridSearch.mockResolvedValue([
        chunkHit("a", "note-a", 0.8),
        chunkHit("b", "note-b", 0.7),
      ]);
      fakeProvider.streamGenerate.mockImplementation(async function* () {
        yield { delta: '{"rankedIds":["chunk:b","chunk:a"]}' };
        yield { usage: { tokensIn: 1, tokensOut: 1, model: "fake" } };
      });

      const result = await retrieveWithPolicy({
        workspaceId: "ws-1",
        query: "alpha",
        ragMode: "strict",
        scope: { type: "project", workspaceId: "ws-1", projectId: "p-1" },
        chips: [],
      });

      expect(fakeProvider.streamGenerate).toHaveBeenCalled();
      expect(result.hits.map((hit) => hit.noteId)).toEqual(["note-b", "note-a"]);
    } finally {
      if (env === undefined) delete process.env.CHAT_RAG_RERANKER;
      else process.env.CHAT_RAG_RERANKER = env;
    }
  });

  it("applies provider reranking once after corrective retry", async () => {
    const env = process.env.CHAT_RAG_RERANKER;
    try {
      process.env.CHAT_RAG_RERANKER = "provider";
      chunkSearch.projectChunkHybridSearch.mockResolvedValue([
        chunkHit("sparse-1", "note-1", 0.25),
      ]);
      graphExpansion.expandGraphCandidates.mockResolvedValue([
        {
          noteId: "note-2",
          chunkId: "chunk-2",
          title: "Related path",
          headingPath: "Impact",
          snippet: "relationship evidence",
          graphScore: 0.9,
          sourceType: null,
          sourceUrl: null,
          updatedAt: null,
        },
      ]);
      fakeProvider.streamGenerate.mockImplementation(async function* () {
        yield {
          delta:
            '{"rankedIds":["graph:chunk:chunk-2","chunk:sparse-1"]}',
        };
        yield { usage: { tokensIn: 1, tokensOut: 1, model: "fake" } };
      });

      const result = await retrieveWithPolicy({
        workspaceId: "ws-1",
        query: "alpha 정의",
        ragMode: "expand",
        scope: { type: "project", workspaceId: "ws-1", projectId: "p-1" },
        chips: [],
      });

      expect(fakeProvider.streamGenerate).toHaveBeenCalledTimes(1);
      expect(result.policy.reasons).toContain("corrective_retry");
      expect(result.qualityReport.retryApplied).toBe(true);
      expect(result.hits.map((hit) => hit.noteId)).toEqual([
        "note-2",
        "note-1",
      ]);
    } finally {
      if (env === undefined) delete process.env.CHAT_RAG_RERANKER;
      else process.env.CHAT_RAG_RERANKER = env;
    }
  });
});

function chunkHit(chunkId: string, noteId: string, score: number) {
  return {
    chunkId,
    noteId,
    title: noteId,
    headingPath: "Eval",
    snippet: "alpha workspace evidence",
    rrfScore: score,
    vectorScore: score,
    bm25Score: null,
  };
}
