import { db, eq, noteChunks, type NewNoteChunk } from "@opencairn/db";
import { chunkNoteText } from "./note-chunker";

export type NoteChunkIndexNote = {
  id: string;
  workspaceId: string;
  projectId: string;
  contentText: string | null;
  deletedAt: Date | null;
};

export type IndexNoteChunksOpts = {
  note: NoteChunkIndexNote;
  embed: (text: string) => Promise<number[]>;
  maxChars?: number;
};

export async function indexNoteChunks(opts: IndexNoteChunksOpts): Promise<void> {
  const chunks = chunkNoteText({
    contentText: opts.note.contentText ?? "",
    maxChars: opts.maxChars,
  });

  const rows: NewNoteChunk[] = await Promise.all(
    chunks.map(async (chunk) => ({
      workspaceId: opts.note.workspaceId,
      projectId: opts.note.projectId,
      noteId: opts.note.id,
      chunkIndex: chunk.chunkIndex,
      headingPath: chunk.headingPath,
      contentText: chunk.contentText,
      embedding: await opts.embed(chunk.contentText),
      tokenCount: chunk.tokenCount,
      sourceOffsets: chunk.sourceOffsets,
      contentHash: chunk.contentHash,
      deletedAt: opts.note.deletedAt,
    })),
  );

  await db.transaction(async (tx) => {
    await tx.delete(noteChunks).where(eq(noteChunks.noteId, opts.note.id));
    if (rows.length > 0) {
      await tx.insert(noteChunks).values(rows);
    }
  });
}
