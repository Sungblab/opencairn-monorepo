import type { NoteChunkIndexNote } from "./note-chunk-indexer";
import { indexNoteChunks } from "./note-chunk-indexer";
import { getChatProvider } from "./llm";
import {
  queueNoteAnalysisJob,
  runNoteAnalysisJob,
  type QueueNoteAnalysisJobOptions,
} from "./note-analysis-jobs";

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
  opts: Pick<
    QueueNoteAnalysisJobOptions,
    "debounceMs" | "yjsStateVector"
  > & { runInline?: boolean } = {},
): Promise<void> {
  try {
    const now = new Date();
    const { jobId } = await queueNoteAnalysisJob(note, { ...opts, now });
    if (jobId && opts.runInline !== false) {
      const provider = getChatProvider();
      await runNoteAnalysisJob({ jobId, embed: provider.embed, now });
    }
  } catch {
    // Chunk indexing is a freshness side effect. Note writes must not fail
    // because an embedding provider is temporarily unavailable or unconfigured.
  }
}
