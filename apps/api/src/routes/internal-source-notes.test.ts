import { beforeEach, describe, expect, it, vi } from "vitest";
import { internalRoutes } from "./internal";

const insertedNotes = vi.hoisted(() => [] as Array<Record<string, unknown>>);
const syncedWikiLinks = vi.hoisted(() => [] as Array<{
  noteId: string;
  targets: string[];
  workspaceId: string;
}>);

function table() {
  return new Proxy({}, { get: (_target, prop) => String(prop) });
}

function query(rows: unknown[]) {
  const chain = {
    from: () => chain,
    where: () => Promise.resolve(rows),
    limit: () => Promise.resolve(rows),
    then: (
      resolve: (value: unknown[]) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(rows).then(resolve, reject),
  };
  return chain;
}

vi.mock("@opencairn/db", () => {
  const t = table();
  const testDb = {
    select: vi.fn(() =>
      query([{ workspaceId: "00000000-0000-4000-8000-000000000001" }]),
    ),
    insert: vi.fn(() => ({
      values: vi.fn((value: Record<string, unknown>) => {
        insertedNotes.push(value);
        return Promise.resolve([]);
      }),
    })),
    transaction: vi.fn((callback: (tx: unknown) => Promise<unknown>) =>
      callback(testDb),
    ),
  };
  return {
    db: testDb,
    projects: t,
    notes: t,
    agentFiles: t,
    extractWikiLinkTargets: vi.fn((content: unknown) => {
      const targets = new Set<string>();
      const stack = Array.isArray(content) ? [...content] : [];
      while (stack.length) {
        const node = stack.pop();
        if (!node || typeof node !== "object") continue;
        const typed = node as {
          type?: string;
          label?: string;
          children?: unknown;
        };
        if (typed.type === "wikilink" && typed.label) {
          targets.add(typed.label);
        }
        if (Array.isArray(typed.children)) stack.push(...typed.children);
      }
      return targets;
    }),
    syncWikiLinks: vi.fn((
      _tx: unknown,
      noteId: string,
      targets: Set<string>,
      workspaceId: string,
    ) => {
      syncedWikiLinks.push({ noteId, targets: [...targets], workspaceId });
      return Promise.resolve();
    }),
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

vi.mock("../lib/project-tree-service", () => ({
  createTreeNode: vi.fn(),
}));

vi.mock("../lib/tree-events", () => ({
  emitTreeEvent: vi.fn(),
}));

vi.mock("../lib/note-chunk-refresh", () => ({
  refreshNoteChunkIndexBestEffort: vi.fn(),
}));

describe("POST /source-notes", () => {
  beforeEach(() => {
    insertedNotes.length = 0;
    syncedWikiLinks.length = 0;
    process.env.INTERNAL_API_SECRET = "test-secret";
  });

  it("persists generated source note content as a Plate value array", async () => {
    const response = await internalRoutes.request("/source-notes", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-secret": "test-secret",
      },
      body: JSON.stringify({
        userId: "user-1",
        projectId: "00000000-0000-4000-8000-000000000002",
        title: "lecture.pdf",
        content: "# Lecture\n\nExtracted text about [[운영체제]]",
        sourceType: "pdf",
        objectKey: "uploads/lecture.pdf",
        mimeType: "application/pdf",
        triggerCompiler: false,
      }),
    });

    expect(response.status).toBe(201);
    expect(insertedNotes[0]?.content).toEqual([
      {
        type: "h1",
        children: [{ text: "Lecture" }],
      },
      {
        type: "p",
        children: [
          { text: "Extracted text about " },
          {
            type: "wikilink",
            noteId: null,
            label: "운영체제",
            children: [{ text: "운영체제" }],
          },
        ],
      },
    ]);
    expect(syncedWikiLinks[0]).toMatchObject({
      targets: ["운영체제"],
      workspaceId: "00000000-0000-4000-8000-000000000001",
    });
  });
});
