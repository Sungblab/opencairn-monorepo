import { db, eq, noteChunks, type NewNoteChunk } from "@opencairn/db";
import { chunkNoteText } from "./note-chunker";

export type NoteChunkIndexNote = {
  id: string;
  workspaceId: string;
  projectId: string;
  title?: string | null;
  contentText: string | null;
  deletedAt: Date | null;
};

export type IndexNoteChunksOpts = {
  note: NoteChunkIndexNote;
  embed: (text: string) => Promise<number[]>;
  maxChars?: number;
};

export async function buildNoteChunkRows(
  opts: IndexNoteChunksOpts,
): Promise<NewNoteChunk[]> {
  const chunks = chunkNoteText({
    contentText: opts.note.contentText ?? "",
    maxChars: opts.maxChars,
  });

  return Promise.all(
    chunks.map(async (chunk) => {
      const contextText = buildChunkContext({
        title: opts.note.title,
        headingPath: chunk.headingPath,
      });
      return {
        workspaceId: opts.note.workspaceId,
        projectId: opts.note.projectId,
        noteId: opts.note.id,
        chunkIndex: chunk.chunkIndex,
        headingPath: chunk.headingPath,
        contextText,
        contentText: chunk.contentText,
        embedding: await opts.embed(
          retrievalText(contextText, chunk.contentText),
        ),
        tokenCount: chunk.tokenCount,
        sourceOffsets: chunk.sourceOffsets,
        contentHash: chunk.contentHash,
        deletedAt: opts.note.deletedAt,
      };
    }),
  );
}

export async function replaceNoteChunks(
  noteId: string,
  rows: NewNoteChunk[],
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(noteChunks).where(eq(noteChunks.noteId, noteId));
    if (rows.length > 0) {
      await tx.insert(noteChunks).values(rows);
    }
  });
}

export async function indexNoteChunks(opts: IndexNoteChunksOpts): Promise<void> {
  const rows = await buildNoteChunkRows(opts);

  await replaceNoteChunks(opts.note.id, rows);
}

export function buildChunkContext(input: {
  title?: string | null;
  headingPath?: string | null;
}): string {
  return [
    input.title?.trim() ? `Page: ${input.title.trim()}` : null,
    input.headingPath?.trim()
      ? `Section path: ${input.headingPath.trim()}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function retrievalText(contextText: string, contentText: string): string {
  return contextText ? `${contextText}\n\n${contentText}` : contentText;
}
