import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  agentRuns,
  audioFiles,
  conceptEdges,
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
  type Tx,
} from "@opencairn/db";
import { requireAuth } from "../middleware/auth";
import { canRead, canWrite } from "../lib/permissions";
import { streamObject } from "../lib/s3-get";
import type { AppEnv } from "../lib/types";

const PLAN8_AGENT_NAMES = [
  "librarian",
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
  "curator_ontology_violation",
  "curator_relation_refinement",
  "curator_hierarchy_cycle",
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

const suggestionStatusSchema = z.object({
  status: z.enum(["accepted", "rejected"]),
});

type SuggestionApplyResult =
  | {
      applied: true;
      action: "edge_relation_updated";
      edgeId: string;
      relationType: string;
    }
  | { applied: true; action: "edge_deleted"; edgeId: string }
  | { applied: false; reason: string };

function payloadString(
  payload: unknown,
  key: string,
): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function conceptEdgeBelongsToProject(
  client: typeof db | Tx,
  edgeId: string,
  projectId: string,
): Promise<boolean> {
  const [edge] = await client
    .select({ id: conceptEdges.id })
    .from(conceptEdges)
    .innerJoin(concepts, eq(concepts.id, conceptEdges.sourceId))
    .where(and(eq(conceptEdges.id, edgeId), eq(concepts.projectId, projectId)))
    .limit(1);
  return Boolean(edge);
}

async function applyAcceptedSuggestion(
  client: typeof db | Tx,
  type: string,
  payload: unknown,
  projectId: string,
): Promise<SuggestionApplyResult> {
  if (type === "curator_hierarchy_cycle") {
    const edgeId =
      payloadString(payload, "reverseEdgeId") ?? payloadString(payload, "edgeId");
    if (!edgeId) return { applied: false, reason: "missing_edge_id" };
    if (!(await conceptEdgeBelongsToProject(client, edgeId, projectId))) {
      return { applied: false, reason: "edge_not_found" };
    }
    await client.delete(conceptEdges).where(eq(conceptEdges.id, edgeId));
    return { applied: true, action: "edge_deleted", edgeId };
  }

  if (type === "curator_ontology_violation") {
    const edgeId = payloadString(payload, "edgeId");
    if (!edgeId) return { applied: false, reason: "missing_edge_id" };
    if (!(await conceptEdgeBelongsToProject(client, edgeId, projectId))) {
      return { applied: false, reason: "edge_not_found" };
    }
    const relationType =
      payloadString(payload, "proposedRelationType") ?? "related-to";
    await client
      .update(conceptEdges)
      .set({ relationType })
      .where(eq(conceptEdges.id, edgeId));
    return {
      applied: true,
      action: "edge_relation_updated",
      edgeId,
      relationType,
    };
  }

  if (type === "curator_relation_refinement") {
    const edgeId = payloadString(payload, "edgeId");
    const relationType = payloadString(payload, "proposedRelationType");
    if (!edgeId || !relationType) {
      return { applied: false, reason: "manual_relation_choice_required" };
    }
    if (!(await conceptEdgeBelongsToProject(client, edgeId, projectId))) {
      return { applied: false, reason: "edge_not_found" };
    }
    await client
      .update(conceptEdges)
      .set({ relationType })
      .where(eq(conceptEdges.id, edgeId));
    return {
      applied: true,
      action: "edge_relation_updated",
      edgeId,
      relationType,
    };
  }

  return { applied: false, reason: "no_apply_handler" };
}

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
          eq(suggestions.status, "pending"),
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
      .where(
        and(
          eq(notes.projectId, projectId),
          isNull(notes.deletedAt),
          isNull(staleAlerts.reviewedAt),
        ),
      )
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

plan8AgentRoutes.patch(
  "/suggestions/:id",
  requireAuth,
  zValidator("param", idParamSchema),
  zValidator("json", suggestionStatusSchema),
  async (c) => {
    const userId = c.get("userId");
    const { id } = c.req.valid("param");
    const { status } = c.req.valid("json");

    const [row] = await db
      .select({
        id: suggestions.id,
        type: suggestions.type,
        payload: suggestions.payload,
        projectId: suggestions.projectId,
        status: suggestions.status,
      })
      .from(suggestions)
      .where(and(eq(suggestions.id, id), eq(suggestions.userId, userId)))
      .limit(1);
    if (!row || !row.projectId) return c.json({ error: "notFound" }, 404);
    const projectId = row.projectId;

    if (!(await canRead(userId, { type: "project", id: projectId }))) {
      return c.json({ error: "notFound" }, 404);
    }
    if (
      status === "accepted" &&
      !(await canWrite(userId, { type: "project", id: projectId }))
    ) {
      return c.json({ error: "forbidden" }, 403);
    }
    if (row.status !== "pending") {
      return c.json({ error: "alreadyResolved" }, 409);
    }

    const applyResult = await db.transaction(async (tx) => {
      const result =
        status === "accepted"
          ? await applyAcceptedSuggestion(tx, row.type, row.payload, projectId)
          : { applied: false as const, reason: "rejected" };

      await tx
        .update(suggestions)
        .set({
          status,
          resolvedAt: new Date(),
        })
        .where(eq(suggestions.id, row.id));

      return result;
    });

    return c.json({ ok: true, status, apply: applyResult });
  },
);

plan8AgentRoutes.patch(
  "/stale-alerts/:id/review",
  requireAuth,
  zValidator("param", idParamSchema),
  async (c) => {
    const userId = c.get("userId");
    const { id } = c.req.valid("param");

    const [row] = await db
      .select({
        id: staleAlerts.id,
        noteId: staleAlerts.noteId,
      })
      .from(staleAlerts)
      .where(eq(staleAlerts.id, id))
      .limit(1);
    if (!row) return c.json({ error: "notFound" }, 404);

    if (!(await canRead(userId, { type: "note", id: row.noteId }))) {
      return c.json({ error: "notFound" }, 404);
    }

    await db
      .update(staleAlerts)
      .set({ reviewedAt: new Date() })
      .where(eq(staleAlerts.id, row.id));

    return c.json({ ok: true });
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
