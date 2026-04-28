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
  });

  it("ragMode=expand uses CHAT_RAG_TOP_K_EXPAND (default 12)", async () => {
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
});
