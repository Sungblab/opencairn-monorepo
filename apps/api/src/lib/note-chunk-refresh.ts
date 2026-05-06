import type { NoteChunkIndexNote } from "./note-chunk-indexer";
import { indexNoteChunks } from "./note-chunk-indexer";
import { getChatProvider } from "./llm";

export async function refreshNoteChunkIndex(
  note: NoteChunkIndexNote,
): Promise<void> {
  const provider = getChatProvider();
  await indexNoteChunks({
    note,
    embed: provider.embed,
  });
}

export async function refreshNoteChunkIndexBestEffort(
  note: NoteChunkIndexNote,
): Promise<void> {
  try {
    await refreshNoteChunkIndex(note);
  } catch {
    // Chunk indexing is a freshness side effect. Note writes must not fail
    // because an embedding provider is temporarily unavailable or unconfigured.
  }
}
