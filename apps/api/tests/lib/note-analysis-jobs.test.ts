import { beforeEach, describe, expect, it, vi } from "vitest";

const values = vi.fn();
const onConflictDoUpdate = vi.fn();
const set = vi.fn();
const where = vi.fn();
const returning = vi.fn();
const deleteWhere = vi.fn();
const insertValues = vi.fn();

const dbMock = {
  insert: vi.fn(() => ({
    values,
  })),
  update: vi.fn(() => ({
    set,
  })),
  query: {
    noteAnalysisJobs: {
      findFirst: vi.fn(),
    },
    notes: {
      findFirst: vi.fn(),
    },
    yjsDocuments: {
      findFirst: vi.fn(),
    },
  },
  transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      query: {
        noteAnalysisJobs: {
          findFirst: vi.fn(),
        },
      },
      delete: vi.fn(() => ({ where: deleteWhere })),
      insert: vi.fn(() => ({ values: insertValues })),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where })) })),
    }),
  ),
};

values.mockReturnValue({ onConflictDoUpdate });
set.mockReturnValue({ where });
where.mockReturnValue({ returning });

vi.mock("@opencairn/db", async (orig) => {
  const real = (await orig()) as object;
  return { ...real, db: dbMock };
});

const {
  computeNoteAnalysisContentHash,
  queueNoteAnalysisJob,
  runNoteAnalysisJob,
} = await import("../../src/lib/note-analysis-jobs.js");

describe("note analysis jobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.query.noteAnalysisJobs.findFirst.mockReset();
    dbMock.query.notes.findFirst.mockReset();
    dbMock.query.yjsDocuments.findFirst.mockReset();
    onConflictDoUpdate.mockResolvedValue(undefined);
    returning.mockResolvedValue([{ id: "job-1" }]);
    insertValues.mockResolvedValue(undefined);
  });

  it("hashes the title and Yjs-derived text that affect retrieval chunks", () => {
    expect(
      computeNoteAnalysisContentHash({
        title: "Title A",
        contentText: "same text",
      }),
    ).not.toBe(
      computeNoteAnalysisContentHash({
        title: "Title B",
        contentText: "same text",
      }),
    );
  });

  it("upserts one debounced latest-version job per note", async () => {
    const runAfter = new Date("2026-05-06T00:00:30.000Z");

    await queueNoteAnalysisJob(
      {
        id: "note-1",
        workspaceId: "ws-1",
        projectId: "project-1",
        title: "Queued",
        contentText: "body",
        deletedAt: null,
      },
      {
        now: new Date("2026-05-06T00:00:00.000Z"),
        debounceMs: 30_000,
        yjsStateVector: new Uint8Array([1, 2, 3]),
      },
    );

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        noteId: "note-1",
        workspaceId: "ws-1",
        projectId: "project-1",
        status: "queued",
        runAfter,
        lastQueuedAt: new Date("2026-05-06T00:00:00.000Z"),
        yjsStateVector: new Uint8Array([1, 2, 3]),
      }),
    );
    expect(onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        target: expect.anything(),
        set: expect.objectContaining({
          status: "queued",
          runAfter,
          lastQueuedAt: new Date("2026-05-06T00:00:00.000Z"),
        }),
      }),
    );
    expect(dbMock.query.noteAnalysisJobs.findFirst).toHaveBeenCalled();
  });

  it("does not write chunks when a newer queued version replaces a running job", async () => {
    dbMock.query.noteAnalysisJobs.findFirst.mockResolvedValue({
      id: "job-1",
      noteId: "note-1",
      contentHash: "old-hash",
      yjsStateVector: new Uint8Array([1]),
      status: "queued",
      runAfter: new Date("2026-05-06T00:00:00.000Z"),
    });
    returning.mockResolvedValue([
      {
        id: "job-1",
        noteId: "note-1",
        contentHash: computeNoteAnalysisContentHash({
          title: "Old",
          contentText: "old text",
        }),
        yjsStateVector: new Uint8Array([1]),
      },
    ]);
    dbMock.query.notes.findFirst.mockResolvedValue({
      id: "note-1",
      workspaceId: "ws-1",
      projectId: "project-1",
      title: "Old",
      contentText: "old text",
      deletedAt: null,
    });
    dbMock.query.yjsDocuments.findFirst.mockResolvedValue({
      stateVector: new Uint8Array([1]),
    });
    dbMock.transaction.mockImplementationOnce(
      async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          query: {
            noteAnalysisJobs: {
              findFirst: vi.fn().mockResolvedValue({
                id: "job-1",
                contentHash: "newer-hash",
                yjsStateVector: new Uint8Array([9]),
                status: "queued",
              }),
            },
          },
          delete: vi.fn(() => ({ where: deleteWhere })),
          insert: vi.fn(() => ({ values: insertValues })),
          update: vi.fn(() => ({ set: vi.fn(() => ({ where })) })),
        }),
    );

    const result = await runNoteAnalysisJob({
      jobId: "job-1",
      embed: async () => [0.1],
      now: new Date("2026-05-06T00:01:00.000Z"),
    });

    expect(result.status).toBe("stale");
    expect(deleteWhere).not.toHaveBeenCalled();
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("rechecks the source note and Yjs vector at commit time before writing chunks", async () => {
    const oldHash = computeNoteAnalysisContentHash({
      title: "Old",
      contentText: "old text",
    });
    dbMock.query.noteAnalysisJobs.findFirst.mockResolvedValue({
      id: "job-1",
      noteId: "note-1",
      contentHash: oldHash,
      yjsStateVector: new Uint8Array([1]),
      status: "queued",
      runAfter: new Date("2026-05-06T00:00:00.000Z"),
    });
    returning.mockResolvedValue([
      {
        id: "job-1",
        noteId: "note-1",
        contentHash: oldHash,
        yjsStateVector: new Uint8Array([1]),
      },
    ]);
    dbMock.query.notes.findFirst.mockResolvedValue({
      id: "note-1",
      workspaceId: "ws-1",
      projectId: "project-1",
      title: "Old",
      contentText: "old text",
      deletedAt: null,
    });
    dbMock.query.yjsDocuments.findFirst.mockResolvedValue({
      stateVector: new Uint8Array([1]),
    });
    const txSelect = vi.fn();
    const selectRows = (rows: unknown[]) => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          for: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue(rows),
          })),
        })),
      })),
    });
    txSelect
      .mockReturnValueOnce(
        selectRows([
          {
            id: "note-1",
            workspaceId: "ws-1",
            projectId: "project-1",
            title: "New",
            contentText: "new text",
            deletedAt: null,
          },
        ]),
      )
      .mockReturnValueOnce(
        selectRows([{ stateVector: new Uint8Array([9]) }]),
      );
    dbMock.transaction.mockImplementationOnce(
      async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          select: txSelect,
          query: {
            noteAnalysisJobs: {
              findFirst: vi.fn().mockResolvedValue({
                id: "job-1",
                contentHash: oldHash,
                yjsStateVector: new Uint8Array([1]),
                status: "running",
              }),
            },
          },
          delete: vi.fn(() => ({ where: deleteWhere })),
          insert: vi.fn(() => ({ values: insertValues })),
          update: vi.fn(() => ({ set: vi.fn(() => ({ where })) })),
        }),
    );

    const result = await runNoteAnalysisJob({
      jobId: "job-1",
      embed: async () => [0.1],
      now: new Date("2026-05-06T00:01:00.000Z"),
    });

    expect(result.status).toBe("stale");
    expect(deleteWhere).not.toHaveBeenCalled();
    expect(insertValues).not.toHaveBeenCalled();
  });
});
