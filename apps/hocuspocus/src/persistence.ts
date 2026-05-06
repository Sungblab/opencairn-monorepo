// Plan 2B Task 13: @hocuspocus/extension-database persistence boundary.
//
// The Y.Doc binary state lives in `yjs_documents` (Plan 2B Task 1). On first
// load for a given document, seed the Y.Doc from the legacy `notes.content`
// Plate JSON so existing notes don't appear empty when collaborative editing
// comes online. On every save, write the canonical Y-state to `yjs_documents`
// AND derive a Plate JSON + plain-text snapshot into `notes.content` +
// `notes.content_text` (mirror — Y-state is authoritative; this mirror exists
// for hybrid-search, snippets, RSS-style previews, and migrations).
//
// Transaction discipline: both writes live in a single tx. yjs_documents is
// upserted first (since notes.content is derived from it), then notes updates.
//
// See docs/architecture/collaboration-model.md § persistence.

import { Database } from "@hocuspocus/extension-database";
import * as Y from "yjs";
import {
  captureNoteVersion,
  yjsDocuments,
  YJS_DOCUMENT_MAX_BYTES,
  notes,
  eq,
  type DB,
} from "@opencairn/db";
import { refreshNoteChunkIndexBestEffort } from "@opencairn/api/note-chunk-refresh";
import { plateToYDoc, yDocToPlate } from "./plate-bridge.js";
import {
  extractWikiLinkTargets,
  resolveWorkspaceForNote,
  syncWikiLinks,
} from "./wiki-link-sync.js";
import { logger } from "./logger.js";

export interface PersistenceDeps {
  db: DB;
}

// Thrown when a Y.Doc state would exceed YJS_DOCUMENT_MAX_BYTES. Named so
// callers / tests can distinguish the cap miss from a generic DB error — the
// DB-level CHECK constraint exists as a backstop, but this pre-check surfaces
// the failure with a richer message before the round-trip.
export class YjsStateTooLargeError extends Error {
  readonly documentName: string;
  readonly stateBytes: number;
  readonly maxBytes: number;
  constructor(documentName: string, stateBytes: number) {
    super(
      `Y.Doc state for ${documentName} is ${stateBytes} bytes, exceeding the ${YJS_DOCUMENT_MAX_BYTES}-byte cap`,
    );
    this.name = "YjsStateTooLargeError";
    this.documentName = documentName;
    this.stateBytes = stateBytes;
    this.maxBytes = YJS_DOCUMENT_MAX_BYTES;
  }
}

// page:<uuid> — mirrors auth.ts and permissions-adapter.ts. Any other
// document-name shape is unsupported and yields null/no-op.
const DOC_RE =
  /^page:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

// Walk a Plate JSON tree and emit a whitespace-joined plain-text snapshot.
// Plate/Slate text leaves live under `text`; structural nodes hold `children`.
// This intentionally drops marks, URLs, and block semantics — the output is
// a best-effort search payload, not a reversible representation.
function extractText(value: unknown[]): string {
  const parts: string[] = [];
  const walk = (n: unknown): void => {
    if (!n || typeof n !== "object") return;
    const node = n as { text?: unknown; children?: unknown };
    if (typeof node.text === "string") {
      parts.push(node.text);
      return;
    }
    if (Array.isArray(node.children)) node.children.forEach(walk);
  };
  value.forEach(walk);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

export interface Persistence {
  fetch: (args: {
    documentName: string;
    context?: unknown;
  }) => Promise<Uint8Array | null>;
  store: (args: {
    documentName: string;
    state: Uint8Array;
    lastContext?: unknown;
  }) => Promise<void>;
  extension: () => Database;
}

export function makePersistence({ db }: PersistenceDeps): Persistence {
  const fetchImpl = async ({
    documentName,
  }: {
    documentName: string;
  }): Promise<Uint8Array | null> => {
    // Fast path: a stored Y-state exists → hand it back verbatim.
    const existing = await db.query.yjsDocuments.findFirst({
      where: eq(yjsDocuments.name, documentName),
    });
    if (existing) return existing.state;

    const m = DOC_RE.exec(documentName);
    if (!m) return null;
    const noteId = m[1]!;

    const note = await db.query.notes.findFirst({
      where: eq(notes.id, noteId),
    });
    if (!note) return null;

    // Idempotency guard: if we previously stamped `yjs_state_loaded_at` but the
    // `yjs_documents` row is now missing (manual deletion, disaster recovery,
    // etc.), do NOT re-seed from `notes.content` — the mirror at this point is
    // downstream of the Y-state that was lost, so re-seeding would resurrect a
    // stale snapshot. Return null; Hocuspocus starts with an empty doc.
    if (note.yjsStateLoadedAt) {
      logger.warn(
        { noteId },
        "persistence.fetch: yjs_state_loaded_at set but no yjs_documents row — starting blank",
      );
      return null;
    }

    // First load for this note: seed Y.Doc from legacy notes.content.
    const seedValue = (note.content as unknown[] | null) ?? [
      { type: "p", children: [{ text: "" }] },
    ];
    const doc = new Y.Doc();
    plateToYDoc(doc, seedValue);
    const state = Y.encodeStateAsUpdate(doc);
    const stateVector = Y.encodeStateVector(doc);

    // Insert the seeded state + stamp notes.yjs_state_loaded_at in a single tx
    // so a concurrent second fetch for the same note cannot re-seed. If the
    // insert loses the race (onConflictDoNothing), the loaded_at stamp still
    // happens — harmless, because the extant row is authoritative anyway.
    await db.transaction(async (tx) => {
      await tx
        .insert(yjsDocuments)
        .values({
          name: documentName,
          state,
          stateVector,
          sizeBytes: state.byteLength,
        })
        .onConflictDoNothing();
      await tx
        .update(notes)
        .set({ yjsStateLoadedAt: new Date() })
        .where(eq(notes.id, noteId));
    });

    logger.info(
      { noteId, bytes: state.byteLength },
      "persistence.fetch: seeded Y.Doc from notes.content",
    );
    return state;
  };

  const storeImpl = async ({
    documentName,
    state,
  }: {
    documentName: string;
    state: Uint8Array;
    lastContext?: unknown;
  }): Promise<void> => {
    const m = DOC_RE.exec(documentName);
    if (!m) {
      logger.warn(
        { documentName },
        "persistence.store: unsupported document name, skipping",
      );
      return;
    }
    const noteId = m[1]!;

    // Size cap pre-check. The DB CHECK is the authoritative guard, but
    // surfacing the failure here avoids a wasted round-trip and gives the
    // caller a specific error class. Plan 2B H-3 / Tier 2 2-7: a runaway
    // Y.Doc (pathological app bug or deliberate wedging attempt) could
    // otherwise pin the hocuspocus store path on an oversize bytea.
    if (state.byteLength > YJS_DOCUMENT_MAX_BYTES) {
      logger.error(
        { noteId, documentName, stateBytes: state.byteLength },
        "persistence.store: Y.Doc state exceeds size cap, rejecting write",
      );
      throw new YjsStateTooLargeError(documentName, state.byteLength);
    }

    // Reconstruct Y.Doc from the canonical update bytes so we can derive a
    // Plate snapshot + plain-text mirror. `state` here is the full state
    // encoded via `Y.encodeStateAsUpdate` (Database extension's contract).
    const doc = new Y.Doc();
    Y.applyUpdate(doc, state);
    const plateValue = yDocToPlate(doc);
    const contentText = extractText(plateValue);
    const stateVector = Y.encodeStateVector(doc);
    const noteRow = await db.query.notes.findFirst({
      where: eq(notes.id, noteId),
    });
    const noteTitle = noteRow?.title ?? "Untitled";

    await db.transaction(async (tx) => {
      await tx
        .insert(yjsDocuments)
        .values({
          name: documentName,
          state,
          stateVector,
          sizeBytes: state.byteLength,
        })
        .onConflictDoUpdate({
          target: yjsDocuments.name,
          set: {
            state,
            stateVector,
            sizeBytes: state.byteLength,
            updatedAt: new Date(),
          },
        });
      await tx
        .update(notes)
        .set({
          // notes.content is jsonb + `.$type<unknown>()` — Plate Value (array)
          // round-trips directly without a cast dance.
          content: plateValue as unknown,
          contentText,
          updatedAt: new Date(),
        })
        .where(eq(notes.id, noteId));
      // Plan 5 Phase 1: rebuild wiki_links index from the just-saved Plate
      // value. workspaceId resolved inside the same tx so a project move
      // mid-flight cannot mis-scope the index.
      const workspaceId = await resolveWorkspaceForNote(tx, noteId);
      if (workspaceId) {
        const targets = extractWikiLinkTargets(plateValue);
        await syncWikiLinks(tx, noteId, targets, workspaceId);
      }
    });

    try {
      await captureNoteVersion({
        database: db,
        noteId,
        title: noteTitle,
        content: plateValue as unknown,
        contentText,
        yjsState: state,
        yjsStateVector: stateVector,
        source: "auto_save",
        actorType: "system",
        actorId: null,
        reason: null,
        force: false,
      });
    } catch (error) {
      logger.warn(
        { noteId, error },
        "persistence.store: note version capture failed",
      );
    }

    if (noteRow) {
      void refreshNoteChunkIndexBestEffort({
        id: noteId,
        workspaceId: noteRow.workspaceId,
        projectId: noteRow.projectId,
        title: noteTitle,
        contentText,
        deletedAt: noteRow.deletedAt,
      }).catch((error) => {
        logger.warn(
          { noteId, error },
          "persistence.store: best-effort chunk refresh failed",
        );
      });
    }
  };

  return {
    fetch: fetchImpl,
    store: storeImpl,
    // @hocuspocus/extension-database v3 accepts `{ fetch, store }`. Its
    // onStoreDocument wraps the payload with `state: Buffer.from(...)`; Buffer
    // is a Uint8Array subclass, so our `state: Uint8Array` contract holds.
    extension: () => new Database({ fetch: fetchImpl, store: storeImpl }),
  };
}
