import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  agentRuns,
  audioFiles,
  concepts,
  db,
  notes,
  projects,
  staleAlerts,
  suggestions,
  and,
  desc,
  eq,
  inArray,
  isNull,
} from "@opencairn/db";
import { requireAuth } from "../middleware/auth";
import { canRead } from "../lib/permissions";
import { streamObject } from "../lib/s3-get";
import type { AppEnv } from "../lib/types";

const PLAN8_AGENT_NAMES = [
  "synthesis",
  "curator",
  "connector",
  "staleness",
  "narrator",
] as const;

const PLAN8_SUGGESTION_TYPES = [
  "connector_link",
  "curator_orphan",
  "curator_duplicate",
  "curator_contradiction",
  "curator_external_source",
  "synthesis_insight",
] as const;

const overviewQuerySchema = z.object({
  projectId: z.string().uuid(),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
});

const idParamSchema = z.object({
  id: z.string().uuid(),
});

export const plan8AgentRoutes = new Hono<AppEnv>();

async function filterReadableNoteRows<T extends { noteId: string | null }>(
  userId: string,
  rows: T[],
): Promise<T[]> {
  const readable = await Promise.all(
    rows.map((row) =>
      row.noteId
        ? canRead(userId, { type: "note", id: row.noteId })
        : Promise.resolve(false),
    ),
  );
  return rows.filter((_, index) => readable[index]);
}

function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

plan8AgentRoutes.get(
  "/overview",
  requireAuth,
  zValidator("query", overviewQuerySchema),
  async (c) => {
    const userId = c.get("userId");
    const { projectId, limit } = c.req.valid("query");

    const [project] = await db
      .select({ id: projects.id, workspaceId: projects.workspaceId })
      .from(projects)
      .where(eq(projects.id, projectId));
    if (!project) return c.json({ error: "notFound" }, 404);
    if (!(await canRead(userId, { type: "project", id: projectId }))) {
      return c.json({ error: "forbidden" }, 403);
    }

    const noteRows = await db
      .select({
        id: notes.id,
        title: notes.title,
        type: notes.type,
        updatedAt: notes.updatedAt,
      })
      .from(notes)
      .where(and(eq(notes.projectId, projectId), isNull(notes.deletedAt)))
      .orderBy(desc(notes.updatedAt))
      .limit(20);
    const readableNotes = await filterReadableNoteRows(
      userId,
      noteRows.map((note) => ({ ...note, noteId: note.id })),
    );

    const conceptRows = await db
      .select({
        id: concepts.id,
        name: concepts.name,
        description: concepts.description,
        createdAt: concepts.createdAt,
      })
      .from(concepts)
      .where(eq(concepts.projectId, projectId))
      .orderBy(desc(concepts.createdAt))
      .limit(20);

    const runRows = await db
      .select({
        runId: agentRuns.runId,
        agentName: agentRuns.agentName,
        workflowId: agentRuns.workflowId,
        status: agentRuns.status,
        startedAt: agentRuns.startedAt,
        endedAt: agentRuns.endedAt,
        totalCostKrw: agentRuns.totalCostKrw,
        errorMessage: agentRuns.errorMessage,
      })
      .from(agentRuns)
      .where(
        and(
          eq(agentRuns.userId, userId),
          eq(agentRuns.projectId, projectId),
          inArray(agentRuns.agentName, [...PLAN8_AGENT_NAMES]),
        ),
      )
      .orderBy(desc(agentRuns.startedAt))
      .limit(limit);

    const suggestionRows = await db
      .select({
        id: suggestions.id,
        type: suggestions.type,
        payload: suggestions.payload,
        status: suggestions.status,
        createdAt: suggestions.createdAt,
        resolvedAt: suggestions.resolvedAt,
      })
      .from(suggestions)
      .where(
        and(
          eq(suggestions.userId, userId),
          eq(suggestions.projectId, projectId),
          inArray(suggestions.type, [...PLAN8_SUGGESTION_TYPES]),
        ),
      )
      .orderBy(desc(suggestions.createdAt))
      .limit(limit);

    const staleRows = await db
      .select({
        id: staleAlerts.id,
        noteId: staleAlerts.noteId,
        noteTitle: notes.title,
        stalenessScore: staleAlerts.stalenessScore,
        reason: staleAlerts.reason,
        detectedAt: staleAlerts.detectedAt,
        reviewedAt: staleAlerts.reviewedAt,
      })
      .from(staleAlerts)
      .innerJoin(notes, eq(notes.id, staleAlerts.noteId))
      .where(and(eq(notes.projectId, projectId), isNull(notes.deletedAt)))
      .orderBy(desc(staleAlerts.detectedAt))
      .limit(limit);
    const readableStaleRows = await filterReadableNoteRows(userId, staleRows);

    const audioRows = await db
      .select({
        id: audioFiles.id,
        noteId: audioFiles.noteId,
        noteTitle: notes.title,
        durationSec: audioFiles.durationSec,
        voices: audioFiles.voices,
        createdAt: audioFiles.createdAt,
      })
      .from(audioFiles)
      .innerJoin(notes, eq(notes.id, audioFiles.noteId))
      .where(and(eq(notes.projectId, projectId), isNull(notes.deletedAt)))
      .orderBy(desc(audioFiles.createdAt))
      .limit(limit);
    const readableAudioRows = await filterReadableNoteRows(userId, audioRows);

    return c.json({
      project,
      launch: {
        notes: readableNotes.map((note) => ({
          id: note.id,
          title: note.title,
          type: note.type,
          updatedAt: note.updatedAt.toISOString(),
        })),
        concepts: conceptRows.map((concept) => ({
          id: concept.id,
          name: concept.name,
          description: concept.description,
          createdAt: concept.createdAt.toISOString(),
        })),
      },
      agentRuns: runRows.map((run) => ({
        runId: run.runId,
        agentName: run.agentName,
        workflowId: run.workflowId,
        status: run.status,
        startedAt: run.startedAt.toISOString(),
        endedAt: toIso(run.endedAt),
        totalCostKrw: run.totalCostKrw,
        errorMessage: run.errorMessage,
      })),
      suggestions: suggestionRows.map((suggestion) => ({
        id: suggestion.id,
        type: suggestion.type,
        payload: suggestion.payload,
        status: suggestion.status,
        createdAt: suggestion.createdAt.toISOString(),
        resolvedAt: toIso(suggestion.resolvedAt),
      })),
      staleAlerts: readableStaleRows.map((alert) => ({
        id: alert.id,
        noteId: alert.noteId,
        noteTitle: alert.noteTitle,
        stalenessScore: alert.stalenessScore,
        reason: alert.reason,
        detectedAt: alert.detectedAt.toISOString(),
        reviewedAt: toIso(alert.reviewedAt),
      })),
      audioFiles: readableAudioRows.map((audio) => ({
        id: audio.id,
        noteId: audio.noteId,
        noteTitle: audio.noteTitle,
        durationSec: audio.durationSec,
        voices: audio.voices,
        createdAt: audio.createdAt.toISOString(),
        urlPath: `/api/agents/plan8/audio-files/${audio.id}/file`,
      })),
    });
  },
);

plan8AgentRoutes.get(
  "/audio-files/:id/file",
  requireAuth,
  zValidator("param", idParamSchema),
  async (c) => {
    const userId = c.get("userId");
    const { id } = c.req.valid("param");

    const [audio] = await db
      .select({
        noteId: audioFiles.noteId,
        r2Key: audioFiles.r2Key,
        noteTitle: notes.title,
      })
      .from(audioFiles)
      .innerJoin(notes, eq(notes.id, audioFiles.noteId))
      .where(and(eq(audioFiles.id, id), isNull(notes.deletedAt)));
    if (!audio?.noteId) return c.json({ error: "notFound" }, 404);
    if (!(await canRead(userId, { type: "note", id: audio.noteId }))) {
      return c.json({ error: "notFound" }, 404);
    }

    const obj = await streamObject(audio.r2Key);
    const safeTitle = audio.noteTitle.replace(/[\r\n"\\]/g, "_");
    const asciiName = `${safeTitle || "narration"}.mp3`.replace(
      /[^\x20-\x7e]/g,
      "_",
    );
    const starName = encodeURIComponent(`${safeTitle || "narration"}.mp3`)
      .replace(/[!'()*]/g, (ch) =>
        "%" + ch.charCodeAt(0).toString(16).toUpperCase(),
      );

    c.header(
      "Content-Type",
      obj.contentType === "application/octet-stream"
        ? "audio/mpeg"
        : obj.contentType,
    );
    c.header("Cache-Control", "private, max-age=3600");
    if (obj.contentLength > 0) {
      c.header("Content-Length", String(obj.contentLength));
    }
    c.header(
      "Content-Disposition",
      `inline; filename="${asciiName}"; filename*=UTF-8''${starName}`,
    );
    return c.body(obj.stream);
  },
);
