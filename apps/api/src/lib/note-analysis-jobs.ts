import { createHash } from "node:crypto";
import {
  and,
  asc,
  db,
  eq,
  incrementNoteAnalysisVersion,
  lte,
  noteAnalysisJobs,
  noteChunks,
  notes,
  yjsDocuments,
  type NewNoteAnalysisJob,
} from "@opencairn/db";
import {
  buildNoteChunkRows,
  type NoteChunkIndexNote,
} from "./note-chunk-indexer";

export type QueueNoteAnalysisJobOptions = {
  now?: Date;
  debounceMs?: number;
  yjsStateVector?: Uint8Array | null;
};

export type RunNoteAnalysisJobOptions = {
  jobId: string;
  embed: (text: string) => Promise<number[]>;
  now?: Date;
};

export type DrainDueNoteAnalysisJobsOptions = {
  batchSize: number;
  embed: (text: string) => Promise<number[]>;
  now?: Date;
};

export type RunNoteAnalysisJobResult =
  | { status: "completed"; jobId: string }
  | { status: "not_found"; jobId: string }
  | { status: "not_due"; jobId: string }
  | { status: "missing_note"; jobId: string }
  | { status: "stale"; jobId: string }
  | { status: "failed"; jobId: string; error: unknown };

export type DrainDueNoteAnalysisJobsResult = {
  results: RunNoteAnalysisJobResult[];
};

export function computeNoteAnalysisContentHash(input: {
  title?: string | null;
  contentText?: string | null;
}): string {
  return createHash("sha256")
    .update(JSON.stringify({
      title: input.title ?? "",
      contentText: input.contentText ?? "",
    }))
    .digest("hex");
}

export async function queueNoteAnalysisJob(
  note: NoteChunkIndexNote,
  opts: QueueNoteAnalysisJobOptions = {},
): Promise<{ jobId: string | null }> {
  const now = opts.now ?? new Date();
  const runAfter = new Date(now.getTime() + (opts.debounceMs ?? 0));
  const row: NewNoteAnalysisJob = {
    workspaceId: note.workspaceId,
    projectId: note.projectId,
    noteId: note.id,
    contentHash: computeNoteAnalysisContentHash(note),
    yjsStateVector: opts.yjsStateVector ?? null,
    status: "queued",
    runAfter,
    lastQueuedAt: now,
    lastStartedAt: null,
    lastCompletedAt: null,
    errorCode: null,
    errorMessage: null,
  };

  await db
    .insert(noteAnalysisJobs)
    .values(row)
    .onConflictDoUpdate({
      target: noteAnalysisJobs.noteId,
      set: {
        workspaceId: row.workspaceId,
        projectId: row.projectId,
        contentHash: row.contentHash,
        yjsStateVector: row.yjsStateVector,
        analysisVersion: incrementNoteAnalysisVersion,
        status: "queued",
        runAfter,
        lastQueuedAt: now,
        lastStartedAt: null,
        lastCompletedAt: null,
        errorCode: null,
        errorMessage: null,
        updatedAt: now,
      },
    });
  const queued = await db.query.noteAnalysisJobs.findFirst({
    where: eq(noteAnalysisJobs.noteId, note.id),
  });
  return { jobId: queued?.id ?? null };
}

export async function runNoteAnalysisJob(
  opts: RunNoteAnalysisJobOptions,
): Promise<RunNoteAnalysisJobResult> {
  const now = opts.now ?? new Date();
  const job = await db.query.noteAnalysisJobs.findFirst({
    where: eq(noteAnalysisJobs.id, opts.jobId),
  });
  if (!job) return { status: "not_found", jobId: opts.jobId };
  if (job.status !== "queued" || job.runAfter > now) {
    return { status: "not_due", jobId: opts.jobId };
  }

  const [runningJob] = await db
    .update(noteAnalysisJobs)
    .set({
      status: "running",
      lastStartedAt: now,
      errorCode: null,
      errorMessage: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(noteAnalysisJobs.id, opts.jobId),
        eq(noteAnalysisJobs.status, "queued"),
        lte(noteAnalysisJobs.runAfter, now),
      ),
    )
    .returning({
      id: noteAnalysisJobs.id,
      noteId: noteAnalysisJobs.noteId,
      contentHash: noteAnalysisJobs.contentHash,
      yjsStateVector: noteAnalysisJobs.yjsStateVector,
    });
  if (!runningJob) return { status: "not_due", jobId: opts.jobId };

  const note = await db.query.notes.findFirst({
    where: eq(notes.id, runningJob.noteId),
  });
  if (!note) {
    await markNoteAnalysisJobFailed(opts.jobId, now, "missing_note", null);
    return { status: "missing_note", jobId: opts.jobId };
  }

  const currentVector = await currentYjsStateVector(runningJob.noteId);
  const currentHash = computeNoteAnalysisContentHash(note);
  if (
    currentHash !== runningJob.contentHash ||
    !sameBytes(currentVector, runningJob.yjsStateVector)
  ) {
    await requeueCurrentNoteAnalysisJob(note, currentVector, now);
    return { status: "stale", jobId: opts.jobId };
  }

  try {
    const rows = await buildNoteChunkRows({
      note,
      embed: opts.embed,
    });

    const committed = await db.transaction(async (tx) => {
      const latest = await tx.query.noteAnalysisJobs.findFirst({
        where: eq(noteAnalysisJobs.id, opts.jobId),
      });
      if (
        !latest ||
        latest.status !== "running" ||
        latest.contentHash !== runningJob.contentHash ||
        !sameBytes(latest.yjsStateVector, runningJob.yjsStateVector)
      ) {
        return false;
      }

      const [latestNote] = await tx
        .select()
        .from(notes)
        .where(eq(notes.id, runningJob.noteId))
        .for("update")
        .limit(1);
      const [latestDoc] = await tx
        .select({ stateVector: yjsDocuments.stateVector })
        .from(yjsDocuments)
        .where(eq(yjsDocuments.name, `page:${runningJob.noteId}`))
        .for("update")
        .limit(1);
      const latestVector = latestDoc?.stateVector ?? null;
      if (
        !latestNote ||
        computeNoteAnalysisContentHash(latestNote) !== runningJob.contentHash ||
        !sameBytes(latestVector, runningJob.yjsStateVector)
      ) {
        if (latestNote) {
          await tx
            .update(noteAnalysisJobs)
            .set({
              workspaceId: latestNote.workspaceId,
              projectId: latestNote.projectId,
              contentHash: computeNoteAnalysisContentHash(latestNote),
              yjsStateVector: latestVector,
              analysisVersion: incrementNoteAnalysisVersion,
              status: "queued",
              runAfter: now,
              lastQueuedAt: now,
              lastStartedAt: null,
              lastCompletedAt: null,
              errorCode: "stale_context",
              errorMessage: "Note content changed before analysis could commit.",
              updatedAt: now,
            })
            .where(eq(noteAnalysisJobs.noteId, runningJob.noteId));
        }
        return false;
      }

      await tx.delete(noteChunks).where(eq(noteChunks.noteId, runningJob.noteId));
      if (rows.length > 0) {
        await tx.insert(noteChunks).values(rows);
      }
      await tx
        .update(noteAnalysisJobs)
        .set({
          status: "completed",
          lastCompletedAt: now,
          errorCode: null,
          errorMessage: null,
          updatedAt: now,
        })
        .where(eq(noteAnalysisJobs.id, opts.jobId));
      return true;
    });

    return committed
      ? { status: "completed", jobId: opts.jobId }
      : { status: "stale", jobId: opts.jobId };
  } catch (error) {
    await markNoteAnalysisJobFailed(
      opts.jobId,
      now,
      "analysis_failed",
      error instanceof Error ? error.message : String(error),
    );
    return { status: "failed", jobId: opts.jobId, error };
  }
}

export async function drainDueNoteAnalysisJobs(
  opts: DrainDueNoteAnalysisJobsOptions,
): Promise<DrainDueNoteAnalysisJobsResult> {
  const now = opts.now ?? new Date();
  const batchSize = Math.max(1, Math.min(opts.batchSize, 100));
  const jobs = await db.query.noteAnalysisJobs.findMany({
    where: and(
      eq(noteAnalysisJobs.status, "queued"),
      lte(noteAnalysisJobs.runAfter, now),
    ),
    orderBy: [asc(noteAnalysisJobs.runAfter), asc(noteAnalysisJobs.lastQueuedAt)],
    limit: batchSize,
    columns: {
      id: true,
    },
  });

  const results: RunNoteAnalysisJobResult[] = [];
  for (const job of jobs) {
    results.push(await runNoteAnalysisJob({
      jobId: job.id,
      embed: opts.embed,
      now,
    }));
  }
  return { results };
}

async function markNoteAnalysisJobFailed(
  jobId: string,
  now: Date,
  errorCode: string,
  errorMessage: string | null,
): Promise<void> {
  await db
    .update(noteAnalysisJobs)
    .set({
      status: "failed",
      errorCode,
      errorMessage,
      updatedAt: now,
    })
    .where(eq(noteAnalysisJobs.id, jobId));
}

async function requeueCurrentNoteAnalysisJob(
  note: NoteChunkIndexNote,
  yjsStateVector: Uint8Array | null,
  now: Date,
): Promise<void> {
  await db
    .update(noteAnalysisJobs)
    .set({
      workspaceId: note.workspaceId,
      projectId: note.projectId,
      contentHash: computeNoteAnalysisContentHash(note),
      yjsStateVector,
      analysisVersion: incrementNoteAnalysisVersion,
      status: "queued",
      runAfter: now,
      lastQueuedAt: now,
      lastStartedAt: null,
      lastCompletedAt: null,
      errorCode: "stale_context",
      errorMessage: "Note content changed before analysis could commit.",
      updatedAt: now,
    })
    .where(eq(noteAnalysisJobs.noteId, note.id));
}

async function currentYjsStateVector(
  noteId: string,
): Promise<Uint8Array | null> {
  const doc = await db.query.yjsDocuments.findFirst({
    where: eq(yjsDocuments.name, `page:${noteId}`),
  });
  return doc?.stateVector ?? null;
}

function sameBytes(
  left: Uint8Array | null,
  right: Uint8Array | null,
): boolean {
  if (!left && !right) return true;
  if (!left || !right) return false;
  if (left.byteLength !== right.byteLength) return false;
  for (let i = 0; i < left.byteLength; i += 1) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}
