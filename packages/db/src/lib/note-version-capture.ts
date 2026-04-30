import { and, desc, eq } from "drizzle-orm";

import { db, type DB } from "../client";
import { noteVersions } from "../schema/note-versions";
import { notes } from "../schema/notes";
import { YJS_DOCUMENT_MAX_BYTES, yjsDocuments } from "../schema/yjs-documents";
import { contentHash } from "./note-version-hash";

export type NoteVersionActorType = "user" | "agent" | "system";
export type NoteVersionSource =
  | "auto_save"
  | "title_change"
  | "ai_edit"
  | "restore"
  | "manual_checkpoint"
  | "import";

const AUTO_SNAPSHOT_MS = 5 * 60 * 1000;
const PLATE_JSON_MAX_BYTES = 2 * 1024 * 1024;
const TEXT_DELTA_THRESHOLD = 200;
const WORD_DELTA_THRESHOLD = 30;
const BLOCK_DELTA_THRESHOLD = 3;

function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function blockCount(content: unknown): number {
  return Array.isArray(content) ? content.length : 0;
}

function isMeaningfulDelta(input: {
  content: unknown;
  contentText: string;
  previousContent: unknown;
  previousText: string;
}): boolean {
  if (
    Math.abs(input.contentText.length - input.previousText.length) >=
    TEXT_DELTA_THRESHOLD
  ) {
    return true;
  }
  if (
    Math.abs(wordCount(input.contentText) - wordCount(input.previousText)) >=
    WORD_DELTA_THRESHOLD
  ) {
    return true;
  }
  return (
    Math.abs(blockCount(input.content) - blockCount(input.previousContent)) >=
    BLOCK_DELTA_THRESHOLD
  );
}

export async function captureNoteVersion(input: {
  database?: DB;
  noteId: string;
  title: string;
  content: unknown;
  contentText: string;
  yjsState: Uint8Array;
  yjsStateVector: Uint8Array;
  source: NoteVersionSource;
  actorType: NoteVersionActorType;
  actorId: string | null;
  reason?: string | null;
  force?: boolean;
}): Promise<{ created: boolean; version: number }> {
  if (jsonBytes(input.content) > PLATE_JSON_MAX_BYTES) {
    throw new Error("version_too_large");
  }
  if (input.yjsState.byteLength > YJS_DOCUMENT_MAX_BYTES) {
    throw new Error("version_too_large");
  }

  const database = input.database ?? db;
  const hash = contentHash({ title: input.title, content: input.content });

  return database.transaction(async (tx) => {
    const [note] = await tx
      .select({
        id: notes.id,
        workspaceId: notes.workspaceId,
        projectId: notes.projectId,
      })
      .from(notes)
      .where(eq(notes.id, input.noteId))
      .for("update");
    if (!note) throw new Error("note_not_found");

    const [latest] = await tx
      .select()
      .from(noteVersions)
      .where(eq(noteVersions.noteId, input.noteId))
      .orderBy(desc(noteVersions.version))
      .limit(1)
      .for("update");

    if (latest?.contentHash === hash) {
      return { created: false, version: latest.version };
    }

    if (!input.force && latest?.source === "auto_save") {
      const ageMs = Date.now() - latest.createdAt.getTime();
      if (
        ageMs < AUTO_SNAPSHOT_MS &&
        !isMeaningfulDelta({
          content: input.content,
          contentText: input.contentText,
          previousContent: latest.content,
          previousText: latest.contentText,
        })
      ) {
        return { created: false, version: latest.version };
      }
    }

    const version = (latest?.version ?? 0) + 1;
    await tx.insert(noteVersions).values({
      noteId: note.id,
      workspaceId: note.workspaceId,
      projectId: note.projectId,
      version,
      title: input.title,
      content: input.content,
      contentText: input.contentText,
      contentHash: hash,
      yjsState: input.yjsState,
      yjsStateVector: input.yjsStateVector,
      actorId: input.actorId,
      actorType: input.actorType,
      source: input.source,
      reason: input.reason ?? null,
    });

    return { created: true, version };
  });
}

export async function restoreNoteVersion(input: {
  database?: DB;
  noteId: string;
  version: number;
  actorId: string;
}): Promise<{
  noteId: string;
  restoredFromVersion: number;
  newVersion: number;
  updatedAt: string;
}> {
  const database = input.database ?? db;

  return database.transaction(async (tx) => {
    const [note] = await tx
      .select()
      .from(notes)
      .where(eq(notes.id, input.noteId))
      .for("update");
    if (!note) throw new Error("note_not_found");

    const [target] = await tx
      .select()
      .from(noteVersions)
      .where(
        and(
          eq(noteVersions.noteId, input.noteId),
          eq(noteVersions.version, input.version),
        ),
      )
      .limit(1)
      .for("update");
    if (!target) throw new Error("version_not_found");
    if (!target.yjsState || !target.yjsStateVector) {
      throw new Error("version_not_restorable");
    }

    const [latest] = await tx
      .select()
      .from(noteVersions)
      .where(eq(noteVersions.noteId, input.noteId))
      .orderBy(desc(noteVersions.version))
      .limit(1)
      .for("update");

    const currentHash = contentHash({
      title: note.title,
      content: note.content ?? [],
    });
    if (
      latest?.contentHash === target.contentHash &&
      currentHash === target.contentHash
    ) {
      throw new Error("version_already_current");
    }

    let nextVersion = (latest?.version ?? 0) + 1;
    const currentDoc = await tx.query.yjsDocuments.findFirst({
      where: eq(yjsDocuments.name, `page:${input.noteId}`),
    });
    if (latest?.contentHash !== currentHash && !currentDoc) {
      throw new Error("current_version_not_restorable");
    }

    if (latest?.contentHash !== currentHash && currentDoc) {
      await tx.insert(noteVersions).values({
        noteId: note.id,
        workspaceId: note.workspaceId,
        projectId: note.projectId,
        version: nextVersion,
        title: note.title,
        content: note.content ?? [],
        contentText: note.contentText ?? "",
        contentHash: currentHash,
        yjsState: currentDoc.state,
        yjsStateVector: currentDoc.stateVector,
        actorId: input.actorId,
        actorType: "user",
        source: "manual_checkpoint",
        reason: `pre-restore checkpoint before v${input.version}`,
      });
      nextVersion += 1;
    }

    const updatedAt = new Date();
    await tx
      .update(notes)
      .set({
        title: target.title,
        content: target.content,
        contentText: target.contentText,
        updatedAt,
      })
      .where(eq(notes.id, input.noteId));

    await tx
      .insert(yjsDocuments)
      .values({
        name: `page:${input.noteId}`,
        state: target.yjsState,
        stateVector: target.yjsStateVector,
        sizeBytes: target.yjsState.byteLength,
        updatedAt,
      })
      .onConflictDoUpdate({
        target: yjsDocuments.name,
        set: {
          state: target.yjsState,
          stateVector: target.yjsStateVector,
          sizeBytes: target.yjsState.byteLength,
          updatedAt,
        },
      });

    await tx.insert(noteVersions).values({
      noteId: note.id,
      workspaceId: note.workspaceId,
      projectId: note.projectId,
      version: nextVersion,
      title: target.title,
      content: target.content,
      contentText: target.contentText,
      contentHash: target.contentHash,
      yjsState: target.yjsState,
      yjsStateVector: target.yjsStateVector,
      actorId: input.actorId,
      actorType: "user",
      source: "restore",
      reason: `restored from v${input.version}`,
    });

    return {
      noteId: input.noteId,
      restoredFromVersion: input.version,
      newVersion: nextVersion,
      updatedAt: updatedAt.toISOString(),
    };
  });
}
