#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  Client as TemporalClient,
  Connection,
  ScheduleAlreadyRunning,
} from "@temporalio/client";
import {
  db,
  eq,
  noteAnalysisJobs,
  noteChunks,
  notes,
} from "@opencairn/db";

const API_BASE_URL = process.env.API_BASE_URL ?? "http://127.0.0.1:4000";
const TEMPORAL_ADDRESS = process.env.TEMPORAL_ADDRESS ?? "127.0.0.1:7233";
const TEMPORAL_NAMESPACE = process.env.TEMPORAL_NAMESPACE ?? "default";
const TEMPORAL_TASK_QUEUE =
  process.env.TEMPORAL_TASK_QUEUE ?? "note-analysis-smoke";
const INTERNAL_API_SECRET = requiredEnv("INTERNAL_API_SECRET");
const SCHEDULE_ID =
  process.env.NOTE_ANALYSIS_DRAIN_SMOKE_SCHEDULE_ID ??
  `note-analysis-drain-live-smoke-${Date.now()}`;
const BATCH_SIZE = boundedNumber(
  process.env.NOTE_ANALYSIS_DRAIN_BATCH_SIZE ?? "25",
  1,
  100,
);
const TIMEOUT_MS = boundedNumber(
  process.env.NOTE_ANALYSIS_DRAIN_SMOKE_TIMEOUT_MS ?? "120000",
  1000,
  600000,
);
const POLL_INTERVAL_MS = 1000;
const KEEP_SCHEDULE = process.env.NOTE_ANALYSIS_DRAIN_SMOKE_KEEP_SCHEDULE === "1";

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function boundedNumber(raw, min, max) {
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`Expected number, got ${raw}`);
  return Math.max(min, Math.min(Math.trunc(value), max));
}

function contentHash(input) {
  return createHash("sha256")
    .update(JSON.stringify({
      title: input.title ?? "",
      contentText: input.contentText ?? "",
    }))
    .digest("hex");
}

async function api(path, init = {}) {
  const headers = new Headers(init.headers ?? {});
  if (!headers.has("origin")) headers.set("origin", "http://localhost:3000");
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    throw new Error(`${init.method ?? "GET"} ${path} -> ${response.status}: ${text}`);
  }
  return body;
}

async function seedDueJob() {
  const seed = await api("/api/internal/test-seed", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-internal-secret": INTERNAL_API_SECRET,
    },
    body: JSON.stringify({}),
  });
  const title = "Note analysis drain live smoke";
  const contentText = "";
  await db
    .update(notes)
    .set({ title, contentText })
    .where(eq(notes.id, seed.noteId));
  await db.delete(noteChunks).where(eq(noteChunks.noteId, seed.noteId));
  await db.delete(noteAnalysisJobs).where(eq(noteAnalysisJobs.noteId, seed.noteId));
  const now = new Date();
  const dueFirst = new Date(0);
  const [job] = await db
    .insert(noteAnalysisJobs)
    .values({
      workspaceId: seed.workspaceId,
      projectId: seed.projectId,
      noteId: seed.noteId,
      contentHash: contentHash({ title, contentText }),
      yjsStateVector: null,
      status: "queued",
      runAfter: dueFirst,
      lastQueuedAt: dueFirst,
      lastStartedAt: null,
      lastCompletedAt: null,
      errorCode: null,
      errorMessage: null,
    })
    .returning({ id: noteAnalysisJobs.id });
  if (!job) throw new Error("failed to seed note_analysis_jobs row");
  return { ...seed, jobId: job.id };
}

async function temporalClient() {
  const connection = await Connection.connect({ address: TEMPORAL_ADDRESS });
  return new TemporalClient({ connection, namespace: TEMPORAL_NAMESPACE });
}

function scheduleOptions() {
  return {
    scheduleId: SCHEDULE_ID,
    spec: {
      cronExpressions: ["*/5 * * * *"],
    },
    action: {
      type: "startWorkflow",
      workflowType: "NoteAnalysisDrainWorkflow",
      workflowId: `${SCHEDULE_ID}-workflow`,
      taskQueue: TEMPORAL_TASK_QUEUE,
      args: [{ batchSize: BATCH_SIZE }],
    },
    state: {
      note: `OpenCairn live smoke schedule; batch_size=${BATCH_SIZE}`,
    },
  };
}

async function ensureSchedule(client) {
  try {
    return await client.schedule.create(scheduleOptions());
  } catch (error) {
    if (!(error instanceof ScheduleAlreadyRunning)) throw error;
    const handle = client.schedule.getHandle(SCHEDULE_ID);
    await handle.update(() => scheduleOptions());
    return handle;
  }
}

async function waitForJob(jobId) {
  const deadline = Date.now() + TIMEOUT_MS;
  let last = null;
  while (Date.now() < deadline) {
    const [job] = await db
      .select()
      .from(noteAnalysisJobs)
      .where(eq(noteAnalysisJobs.id, jobId))
      .limit(1);
    last = job ?? null;
    if (job?.status === "completed") return job;
    if (job?.status === "failed") {
      throw new Error(
        `note analysis job failed: ${job.errorCode ?? "unknown"} ${job.errorMessage ?? ""}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`note analysis job did not complete before timeout; last=${JSON.stringify(last)}`);
}

async function main() {
  const seed = await seedDueJob();
  const client = await temporalClient();
  const handle = await ensureSchedule(client);
  await handle.trigger();
  const completed = await waitForJob(seed.jobId);
  const description = await handle.describe();
  if (!KEEP_SCHEDULE) await handle.delete();
  console.log(JSON.stringify({
    ok: true,
    scheduleId: SCHEDULE_ID,
    workflowType: "NoteAnalysisDrainWorkflow",
    taskQueue: TEMPORAL_TASK_QUEUE,
    jobId: seed.jobId,
    noteId: seed.noteId,
    status: completed.status,
    completedAt: completed.lastCompletedAt,
    recentActions: description.info.recentActions.slice(0, 3),
    scheduleDeleted: !KEEP_SCHEDULE,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
