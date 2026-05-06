import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as Y from "yjs";
import {
  createDb,
  notes,
  yjsDocuments,
  YJS_DOCUMENT_MAX_BYTES,
  eq,
} from "@opencairn/db";
import {
  makePersistence,
  YjsStateTooLargeError,
} from "../src/persistence.js";
import { PLATE_BRIDGE_ROOT_KEY } from "../src/plate-bridge.js";
import {
  seedMultiRoleWorkspace,
  type SeedMultiRoleResult,
} from "../../api/tests/helpers/seed.js";

vi.mock("@opencairn/api/note-chunk-refresh", () => ({
  refreshNoteChunkIndexBestEffort: vi.fn().mockResolvedValue(undefined),
}));

const chunkRefresh = (await import(
  "@opencairn/api/note-chunk-refresh"
)) as unknown as {
  refreshNoteChunkIndexBestEffort: ReturnType<typeof vi.fn>;
};

// Plan 2B Task 13: persistence boundary integration tests.
// Like permissions-adapter.test.ts, we own our own pool via createDb(url).
const db = createDb(process.env.DATABASE_URL!);
const persistence = makePersistence({ db });

describe("persistence", () => {
  let seed: SeedMultiRoleResult;
  beforeEach(async () => {
    seed = await seedMultiRoleWorkspace();
  });
  afterEach(async () => {
    await seed?.cleanup();
    chunkRefresh.refreshNoteChunkIndexBestEffort.mockReset();
    chunkRefresh.refreshNoteChunkIndexBestEffort.mockResolvedValue(undefined);
  });

  it("fetch seeds Y.Doc from notes.content on first load and stamps yjs_state_loaded_at", async () => {
    await db
      .update(notes)
      .set({
        content: [{ type: "p", children: [{ text: "seeded body" }] }],
        contentText: "seeded body",
      })
      .where(eq(notes.id, seed.noteId));

    const bytes = await persistence.fetch({
      documentName: `page:${seed.noteId}`,
    });
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes!.byteLength).toBeGreaterThan(0);

    // Stamp side-effect: notes.yjs_state_loaded_at is now set.
    const row = await db.query.notes.findFirst({
      where: eq(notes.id, seed.noteId),
    });
    expect(row?.yjsStateLoadedAt).toBeInstanceOf(Date);

    // And the canonical Y.Doc row was inserted.
    const docRow = await db.query.yjsDocuments.findFirst({
      where: eq(yjsDocuments.name, `page:${seed.noteId}`),
    });
    expect(docRow?.state).toBeInstanceOf(Uint8Array);
    expect(docRow!.state.byteLength).toBeGreaterThan(0);
    expect(docRow!.stateVector).toBeInstanceOf(Uint8Array);

    // Round-trip sanity: decoding the seeded state should expose "seeded body".
    const doc = new Y.Doc();
    Y.applyUpdate(doc, docRow!.state);
    const xml = doc.get(PLATE_BRIDGE_ROOT_KEY, Y.XmlText) as Y.XmlText;
    expect(xml.toString()).toContain("seeded body");
  });

  it("fetch returns stored yjs_documents state on subsequent loads without re-seeding", async () => {
    await db
      .update(notes)
      .set({
        content: [{ type: "p", children: [{ text: "first payload" }] }],
      })
      .where(eq(notes.id, seed.noteId));

    const first = await persistence.fetch({
      documentName: `page:${seed.noteId}`,
    });
    expect(first).toBeInstanceOf(Uint8Array);

    // Mutate notes.content AFTER the first fetch. Second fetch must NOT
    // re-read the mirror — the stored Y-state is authoritative now.
    await db
      .update(notes)
      .set({
        content: [{ type: "p", children: [{ text: "mirror drift" }] }],
      })
      .where(eq(notes.id, seed.noteId));

    const second = await persistence.fetch({
      documentName: `page:${seed.noteId}`,
    });
    expect(second).toBeInstanceOf(Uint8Array);

    const doc = new Y.Doc();
    Y.applyUpdate(doc, second!);
    const xml = doc.get(PLATE_BRIDGE_ROOT_KEY, Y.XmlText) as Y.XmlText;
    expect(xml.toString()).toContain("first payload");
    expect(xml.toString()).not.toContain("mirror drift");
  });

  it("store writes Y.Doc state AND updates notes.content + content_text in one tx", async () => {
    // Seed once so yjs_state_loaded_at is stamped + we have a baseline Y-state.
    await persistence.fetch({ documentName: `page:${seed.noteId}` });

    // Simulate an edit: load the stored state, mutate the shared XmlText,
    // then call store with the full encoded state as Hocuspocus would.
    const doc = new Y.Doc();
    const prior = await db.query.yjsDocuments.findFirst({
      where: eq(yjsDocuments.name, `page:${seed.noteId}`),
    });
    if (prior?.state) Y.applyUpdate(doc, prior.state);

    const xml = doc.get(PLATE_BRIDGE_ROOT_KEY, Y.XmlText) as Y.XmlText;
    xml.insert(0, "hello from test");

    const fullState = Y.encodeStateAsUpdate(doc);
    await persistence.store({
      documentName: `page:${seed.noteId}`,
      state: fullState,
      lastContext: { userId: seed.editorUserId, readOnly: false },
    });

    // notes.content_text reflects the edit (plain-text mirror).
    const row = await db.query.notes.findFirst({
      where: eq(notes.id, seed.noteId),
    });
    expect(row?.contentText ?? "").toContain("hello from test");
    // notes.content is a non-empty Plate array mirror.
    expect(Array.isArray(row?.content)).toBe(true);
    expect((row?.content as unknown[]).length).toBeGreaterThan(0);

    // yjs_documents row was updated (state + stateVector both present).
    const stored = await db.query.yjsDocuments.findFirst({
      where: eq(yjsDocuments.name, `page:${seed.noteId}`),
    });
    expect(stored?.state).toBeInstanceOf(Uint8Array);
    expect(stored!.state.byteLength).toBeGreaterThan(0);
    expect(stored!.stateVector).toBeInstanceOf(Uint8Array);
  });

  it("store ignores unsupported document names", async () => {
    await expect(
      persistence.store({
        documentName: "workspace:xxx",
        state: new Uint8Array(),
        lastContext: {},
      }),
    ).resolves.toBeUndefined();
  });

  it("fetch returns null for an unknown note id", async () => {
    const randomId = "00000000-0000-4000-8000-000000000001";
    const bytes = await persistence.fetch({
      documentName: `page:${randomId}`,
    });
    expect(bytes).toBeNull();
  });

  it("store rejects states above YJS_DOCUMENT_MAX_BYTES before touching the DB", async () => {
    await persistence.fetch({ documentName: `page:${seed.noteId}` });
    const priorRow = await db.query.yjsDocuments.findFirst({
      where: eq(yjsDocuments.name, `page:${seed.noteId}`),
    });
    const priorBytes = priorRow!.sizeBytes;

    // Fabricate an oversize payload. We do not need a valid Y-update here —
    // the size guard must fire BEFORE Y.applyUpdate would parse it.
    const oversize = new Uint8Array(YJS_DOCUMENT_MAX_BYTES + 1);
    await expect(
      persistence.store({
        documentName: `page:${seed.noteId}`,
        state: oversize,
        lastContext: { userId: seed.editorUserId, readOnly: false },
      }),
    ).rejects.toBeInstanceOf(YjsStateTooLargeError);

    // DB row must be untouched — size_bytes + state remain the pre-call values.
    const afterRow = await db.query.yjsDocuments.findFirst({
      where: eq(yjsDocuments.name, `page:${seed.noteId}`),
    });
    expect(afterRow!.sizeBytes).toBe(priorBytes);
  });

  it("store writes size_bytes alongside state so rollup queries are accurate", async () => {
    await persistence.fetch({ documentName: `page:${seed.noteId}` });

    const doc = new Y.Doc();
    const prior = await db.query.yjsDocuments.findFirst({
      where: eq(yjsDocuments.name, `page:${seed.noteId}`),
    });
    if (prior?.state) Y.applyUpdate(doc, prior.state);
    (doc.get(PLATE_BRIDGE_ROOT_KEY, Y.XmlText) as Y.XmlText).insert(
      0,
      "sizeBytes audit",
    );
    const fullState = Y.encodeStateAsUpdate(doc);

    await persistence.store({
      documentName: `page:${seed.noteId}`,
      state: fullState,
      lastContext: { userId: seed.editorUserId, readOnly: false },
    });

    const after = await db.query.yjsDocuments.findFirst({
      where: eq(yjsDocuments.name, `page:${seed.noteId}`),
    });
    expect(after!.sizeBytes).toBe(after!.state.byteLength);
  });

  it("store does not wait for chunk refresh on the autosave hot path", async () => {
    await persistence.fetch({ documentName: `page:${seed.noteId}` });
    const prior = await db.query.yjsDocuments.findFirst({
      where: eq(yjsDocuments.name, `page:${seed.noteId}`),
    });
    const doc = new Y.Doc();
    if (prior?.state) Y.applyUpdate(doc, prior.state);
    (doc.get(PLATE_BRIDGE_ROOT_KEY, Y.XmlText) as Y.XmlText).insert(
      0,
      "nonblocking refresh",
    );
    const fullState = Y.encodeStateAsUpdate(doc);
    const never = new Promise<void>(() => {});
    chunkRefresh.refreshNoteChunkIndexBestEffort.mockReturnValue(never);

    const result = await Promise.race([
      persistence
        .store({
          documentName: `page:${seed.noteId}`,
          state: fullState,
          lastContext: { userId: seed.editorUserId, readOnly: false },
        })
        .then(() => "stored"),
      new Promise((resolve) => setTimeout(() => resolve("blocked"), 50)),
    ]);

    expect(result).toBe("stored");
    expect(chunkRefresh.refreshNoteChunkIndexBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        id: seed.noteId,
        contentText: expect.stringContaining("nonblocking refresh"),
      }),
      expect.objectContaining({
        yjsStateVector: expect.any(Uint8Array),
      }),
    );
  });

  it("store succeeds when best-effort chunk refresh rejects", async () => {
    await persistence.fetch({ documentName: `page:${seed.noteId}` });
    const prior = await db.query.yjsDocuments.findFirst({
      where: eq(yjsDocuments.name, `page:${seed.noteId}`),
    });
    const doc = new Y.Doc();
    if (prior?.state) Y.applyUpdate(doc, prior.state);
    (doc.get(PLATE_BRIDGE_ROOT_KEY, Y.XmlText) as Y.XmlText).insert(
      0,
      "refresh rejection",
    );
    const fullState = Y.encodeStateAsUpdate(doc);
    chunkRefresh.refreshNoteChunkIndexBestEffort.mockRejectedValue(
      new Error("embedding provider unavailable"),
    );

    await expect(
      persistence.store({
        documentName: `page:${seed.noteId}`,
        state: fullState,
        lastContext: { userId: seed.editorUserId, readOnly: false },
      }),
    ).resolves.toBeUndefined();
  });

  it("extension() returns a @hocuspocus/extension-database Database instance", () => {
    const ext = persistence.extension();
    // Duck-type: Database implements Extension → has onLoadDocument +
    // onStoreDocument. Avoids leaking the concrete type into callers.
    expect(typeof (ext as unknown as { onLoadDocument: unknown }).onLoadDocument).toBe(
      "function",
    );
    expect(typeof (ext as unknown as { onStoreDocument: unknown }).onStoreDocument).toBe(
      "function",
    );
  });
});
