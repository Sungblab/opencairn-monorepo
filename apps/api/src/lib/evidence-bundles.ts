import {
  and,
  conceptEdgeEvidence,
  conceptEdges,
  conceptExtractionChunks,
  conceptExtractions,
  concepts,
  db,
  eq,
  evidenceBundleChunks,
  evidenceBundles,
  inArray,
  isNull,
  knowledgeClaims,
  noteChunks,
  notes,
  projects,
} from "@opencairn/db";
import type {
  CreateConceptExtractionInput,
  CreateEvidenceBundleInput,
  EvidenceBundle,
  EvidenceEntry,
  GraphEdgeEvidenceResponse,
} from "@opencairn/shared";
import { graphEdgeEvidenceResponseSchema } from "@opencairn/shared";
import { canRead } from "./permissions";

type EvidenceBundleChunkReadRow = {
  noteChunkId: string;
  noteId: string;
  noteType: "source" | "wiki" | "note";
  sourceType: string | null;
  headingPath: string;
  sourceOffsets: { start: number; end: number };
  score: number;
  rank: number;
  retrievalChannel: string;
  quote: string;
  citation: EvidenceEntry["citation"];
  metadata: Record<string, unknown>;
};

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

export class EvidenceAccessDeniedError extends Error {
  constructor() {
    super("evidence_access_denied");
    this.name = "EvidenceAccessDeniedError";
  }
}

function mapEntry(row: EvidenceBundleChunkReadRow): EvidenceEntry {
  return {
    noteChunkId: row.noteChunkId,
    noteId: row.noteId,
    noteType: row.noteType,
    sourceType: row.sourceType,
    headingPath: row.headingPath,
    sourceOffsets: row.sourceOffsets,
    score: Number(row.score),
    rank: row.rank,
    retrievalChannel: row.retrievalChannel as EvidenceEntry["retrievalChannel"],
    quote: row.quote,
    citation: row.citation,
    metadata: row.metadata ?? {},
  };
}

async function readableNoteIdsForRows(
  userId: string,
  rows: Array<{ noteId: string }>,
): Promise<Set<string>> {
  const uniqueNoteIds = [...new Set(rows.map((row) => row.noteId))];
  const checks = await Promise.all(
    uniqueNoteIds.map(async (noteId) => ({
      noteId,
      readable: await canRead(userId, { type: "note", id: noteId }),
    })),
  );
  return new Set(
    checks.filter((check) => check.readable).map((check) => check.noteId),
  );
}

export async function validateEvidenceBundleInput(
  input: CreateEvidenceBundleInput,
): Promise<"ok" | "project_not_found" | "workspace_mismatch" | "chunk_mismatch"> {
  const [project] = await db
    .select({ workspaceId: projects.workspaceId })
    .from(projects)
    .where(eq(projects.id, input.projectId));
  if (!project) return "project_not_found";
  if (project.workspaceId !== input.workspaceId) return "workspace_mismatch";

  const chunkIds = [...new Set(input.entries.map((entry) => entry.noteChunkId))];
  const rows = await db
    .select({
      id: noteChunks.id,
      noteId: noteChunks.noteId,
    })
    .from(noteChunks)
    .innerJoin(notes, eq(notes.id, noteChunks.noteId))
    .where(
      and(
        inArray(noteChunks.id, chunkIds),
        eq(noteChunks.workspaceId, input.workspaceId),
        eq(noteChunks.projectId, input.projectId),
        isNull(noteChunks.deletedAt),
        isNull(notes.deletedAt),
      ),
    );

  const byChunkId = new Map(rows.map((row) => [row.id, row.noteId]));
  for (const entry of input.entries) {
    if (byChunkId.get(entry.noteChunkId) !== entry.noteId) {
      return "chunk_mismatch";
    }
  }

  return "ok";
}

export async function createEvidenceBundle(
  input: CreateEvidenceBundleInput,
): Promise<{ id: string; createdAt: Date }> {
  return await db.transaction(async (tx) => {
    const [bundle] = await tx
      .insert(evidenceBundles)
      .values({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        purpose: input.purpose,
        producerKind: input.producer.kind,
        producerRunId: input.producer.runId,
        model: input.producer.model,
        tool: input.producer.tool,
        query: input.query,
        createdBy: input.createdBy,
      })
      .returning({
        id: evidenceBundles.id,
        createdAt: evidenceBundles.createdAt,
      });

    if (!bundle) throw new Error("evidence_bundle_insert_failed");

    await tx.insert(evidenceBundleChunks).values(
      input.entries.map((entry) => ({
        bundleId: bundle.id,
        noteChunkId: entry.noteChunkId,
        noteId: entry.noteId,
        rank: entry.rank,
        score: entry.score,
        retrievalChannel: entry.retrievalChannel,
        headingPath: entry.headingPath,
        sourceOffsets: entry.sourceOffsets,
        quote: entry.quote,
        citation: entry.citation,
        metadata: entry.metadata,
      })),
    );

    return bundle;
  });
}

export async function getEvidenceBundleForUser(
  userId: string,
  bundleId: string,
): Promise<EvidenceBundle | null> {
  const [bundle] = await db
    .select()
    .from(evidenceBundles)
    .where(eq(evidenceBundles.id, bundleId));
  if (!bundle) return null;

  if (!(await canRead(userId, { type: "project", id: bundle.projectId }))) {
    throw new EvidenceAccessDeniedError();
  }

  const rows = await db
    .select({
      noteChunkId: evidenceBundleChunks.noteChunkId,
      noteId: evidenceBundleChunks.noteId,
      noteType: notes.type,
      sourceType: notes.sourceType,
      headingPath: evidenceBundleChunks.headingPath,
      sourceOffsets: evidenceBundleChunks.sourceOffsets,
      score: evidenceBundleChunks.score,
      rank: evidenceBundleChunks.rank,
      retrievalChannel: evidenceBundleChunks.retrievalChannel,
      quote: evidenceBundleChunks.quote,
      citation: evidenceBundleChunks.citation,
      metadata: evidenceBundleChunks.metadata,
    })
    .from(evidenceBundleChunks)
    .innerJoin(notes, eq(notes.id, evidenceBundleChunks.noteId))
    .innerJoin(noteChunks, eq(noteChunks.id, evidenceBundleChunks.noteChunkId))
    .where(
      and(
        eq(evidenceBundleChunks.bundleId, bundle.id),
        isNull(notes.deletedAt),
        isNull(noteChunks.deletedAt),
      ),
    );

  const readableNoteIds = await readableNoteIdsForRows(userId, rows);
  const readableRows = rows.filter((row) => readableNoteIds.has(row.noteId));

  return {
    id: bundle.id,
    workspaceId: bundle.workspaceId,
    projectId: bundle.projectId,
    purpose: bundle.purpose as EvidenceBundle["purpose"],
    producer: {
      kind: bundle.producerKind as EvidenceBundle["producer"]["kind"],
      ...(bundle.producerRunId ? { runId: bundle.producerRunId } : {}),
      ...(bundle.model ? { model: bundle.model } : {}),
      ...(bundle.tool ? { tool: bundle.tool } : {}),
    },
    ...(bundle.query ? { query: bundle.query } : {}),
    entries: readableRows.map(mapEntry).sort((a, b) => a.rank - b.rank),
    createdBy: bundle.createdBy,
    createdAt: toIso(bundle.createdAt),
  };
}

export async function getGraphEdgeEvidenceForUser(
  userId: string,
  projectId: string,
  edgeId: string,
): Promise<GraphEdgeEvidenceResponse | null> {
  if (!(await canRead(userId, { type: "project", id: projectId }))) {
    throw new EvidenceAccessDeniedError();
  }

  const [edge] = await db
    .select({
      id: conceptEdges.id,
      sourceId: conceptEdges.sourceId,
      targetId: conceptEdges.targetId,
    })
    .from(conceptEdges)
    .where(eq(conceptEdges.id, edgeId));
  if (!edge) return null;

  const edgeConcepts = await db
    .select({ id: concepts.id })
    .from(concepts)
    .where(
      and(
        inArray(concepts.id, [edge.sourceId, edge.targetId]),
        eq(concepts.projectId, projectId),
      ),
    );
  if (edgeConcepts.length !== 2) return null;

  const evidenceRows = await db
    .select({
      claimId: knowledgeClaims.id,
      claimText: knowledgeClaims.claimText,
      status: knowledgeClaims.status,
      confidence: knowledgeClaims.confidence,
      evidenceBundleId: knowledgeClaims.evidenceBundleId,
      noteChunkId: evidenceBundleChunks.noteChunkId,
      noteId: evidenceBundleChunks.noteId,
      noteType: notes.type,
      sourceType: notes.sourceType,
      headingPath: evidenceBundleChunks.headingPath,
      sourceOffsets: evidenceBundleChunks.sourceOffsets,
      score: evidenceBundleChunks.score,
      rank: evidenceBundleChunks.rank,
      retrievalChannel: evidenceBundleChunks.retrievalChannel,
      quote: evidenceBundleChunks.quote,
      citation: evidenceBundleChunks.citation,
      metadata: evidenceBundleChunks.metadata,
    })
    .from(conceptEdgeEvidence)
    .innerJoin(
      knowledgeClaims,
      eq(knowledgeClaims.id, conceptEdgeEvidence.claimId),
    )
    .innerJoin(
      evidenceBundleChunks,
      and(
        eq(evidenceBundleChunks.bundleId, knowledgeClaims.evidenceBundleId),
        eq(evidenceBundleChunks.noteChunkId, conceptEdgeEvidence.noteChunkId),
      ),
    )
    .innerJoin(notes, eq(notes.id, evidenceBundleChunks.noteId))
    .innerJoin(noteChunks, eq(noteChunks.id, evidenceBundleChunks.noteChunkId))
    .where(
      and(
        eq(conceptEdgeEvidence.conceptEdgeId, edgeId),
        eq(knowledgeClaims.projectId, projectId),
        isNull(notes.deletedAt),
        isNull(noteChunks.deletedAt),
      ),
    );

  const claims = new Map<
    string,
    GraphEdgeEvidenceResponse["claims"][number]
  >();
  const readableNoteIds = await readableNoteIdsForRows(userId, evidenceRows);
  for (const row of evidenceRows) {
    if (!readableNoteIds.has(row.noteId)) {
      continue;
    }
    const existing = claims.get(row.claimId);
    const claim =
      existing ??
      {
        claimId: row.claimId,
        claimText: row.claimText,
        status: row.status as GraphEdgeEvidenceResponse["claims"][number]["status"],
        confidence: Number(row.confidence),
        evidenceBundleId: row.evidenceBundleId,
        evidence: [],
      };
    claim.evidence.push(mapEntry(row));
    claims.set(row.claimId, claim);
  }

  const response = {
    edgeId,
    claims: [...claims.values()].map((claim) => ({
      ...claim,
      evidence: claim.evidence.sort((a, b) => a.rank - b.rank),
    })),
  };
  return graphEdgeEvidenceResponseSchema.parse(response);
}

export async function createConceptExtractionEvidence(
  input: CreateConceptExtractionInput,
): Promise<{ id: string }> {
  const validation = await validateConceptExtractionInput(input);
  if (validation !== "ok") {
    throw new Error(validation);
  }

  return await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(conceptExtractions)
      .values({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        conceptId: input.conceptId ?? null,
        name: input.name,
        kind: input.kind,
        normalizedName: input.normalizedName,
        description: input.description,
        confidence: input.confidence,
        evidenceBundleId: input.evidenceBundleId,
        sourceNoteId: input.sourceNoteId ?? null,
        createdByRunId: input.createdByRunId,
      })
      .returning({ id: conceptExtractions.id });
    if (!row) throw new Error("concept_extraction_insert_failed");

    await tx.insert(conceptExtractionChunks).values(
      input.chunks.map((chunk) => ({
        extractionId: row.id,
        noteChunkId: chunk.noteChunkId,
        supportScore: chunk.supportScore,
        quote: chunk.quote,
      })),
    );

    return row;
  });
}

async function validateConceptExtractionInput(
  input: CreateConceptExtractionInput,
): Promise<"ok" | "project_not_found" | "workspace_mismatch" | "bundle_mismatch" | "concept_mismatch" | "note_mismatch" | "chunk_mismatch"> {
  const [project] = await db
    .select({ workspaceId: projects.workspaceId })
    .from(projects)
    .where(eq(projects.id, input.projectId));
  if (!project) return "project_not_found";
  if (project.workspaceId !== input.workspaceId) return "workspace_mismatch";

  const [bundle] = await db
    .select({ id: evidenceBundles.id })
    .from(evidenceBundles)
    .where(
      and(
        eq(evidenceBundles.id, input.evidenceBundleId),
        eq(evidenceBundles.workspaceId, input.workspaceId),
        eq(evidenceBundles.projectId, input.projectId),
      ),
    );
  if (!bundle) return "bundle_mismatch";

  if (input.conceptId) {
    const [concept] = await db
      .select({ id: concepts.id })
      .from(concepts)
      .where(
        and(eq(concepts.id, input.conceptId), eq(concepts.projectId, input.projectId)),
      );
    if (!concept) return "concept_mismatch";
  }

  if (input.sourceNoteId) {
    const [note] = await db
      .select({ id: notes.id })
      .from(notes)
      .where(
        and(
          eq(notes.id, input.sourceNoteId),
          eq(notes.workspaceId, input.workspaceId),
          eq(notes.projectId, input.projectId),
          isNull(notes.deletedAt),
        ),
      );
    if (!note) return "note_mismatch";
  }

  const chunkIds = [...new Set(input.chunks.map((chunk) => chunk.noteChunkId))];
  const bundleChunkRows = await db
    .select({ noteChunkId: evidenceBundleChunks.noteChunkId })
    .from(evidenceBundleChunks)
    .innerJoin(noteChunks, eq(noteChunks.id, evidenceBundleChunks.noteChunkId))
    .where(
      and(
        eq(evidenceBundleChunks.bundleId, input.evidenceBundleId),
        inArray(evidenceBundleChunks.noteChunkId, chunkIds),
        eq(noteChunks.workspaceId, input.workspaceId),
        eq(noteChunks.projectId, input.projectId),
        isNull(noteChunks.deletedAt),
      ),
    );
  if (new Set(bundleChunkRows.map((row) => row.noteChunkId)).size !== chunkIds.length) {
    return "chunk_mismatch";
  }

  return "ok";
}

export type CreateKnowledgeClaimInput = {
  workspaceId: string;
  projectId: string;
  claimText: string;
  claimType: string;
  status: string;
  confidence: number;
  subjectConceptId?: string;
  objectConceptId?: string;
  evidenceBundleId: string;
  producedBy: string;
  producedByRunId?: string;
  edgeEvidence?: Array<{
    conceptEdgeId: string;
    noteChunkId: string;
    supportScore: number;
    stance: string;
    quote: string;
  }>;
};

export async function createKnowledgeClaim(
  input: CreateKnowledgeClaimInput,
): Promise<{ claimId: string; edgeEvidenceIds: string[] }> {
  const validation = await validateKnowledgeClaimInput(input);
  if (validation !== "ok") {
    throw new Error(validation);
  }

  return await db.transaction(async (tx) => {
    const [claim] = await tx
      .insert(knowledgeClaims)
      .values({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        claimText: input.claimText,
        claimType: input.claimType,
        status: input.status,
        confidence: input.confidence,
        subjectConceptId: input.subjectConceptId ?? null,
        objectConceptId: input.objectConceptId ?? null,
        evidenceBundleId: input.evidenceBundleId,
        producedBy: input.producedBy,
        producedByRunId: input.producedByRunId ?? null,
      })
      .returning({ id: knowledgeClaims.id });
    if (!claim) throw new Error("knowledge_claim_insert_failed");

    const edgeEvidence = input.edgeEvidence ?? [];
    if (edgeEvidence.length === 0) {
      return { claimId: claim.id, edgeEvidenceIds: [] };
    }

    const rows = await tx
      .insert(conceptEdgeEvidence)
      .values(
        edgeEvidence.map((entry) => ({
          conceptEdgeId: entry.conceptEdgeId,
          claimId: claim.id,
          evidenceBundleId: input.evidenceBundleId,
          noteChunkId: entry.noteChunkId,
          supportScore: entry.supportScore,
          stance: entry.stance,
          quote: entry.quote,
        })),
      )
      .returning({ id: conceptEdgeEvidence.id });

    return { claimId: claim.id, edgeEvidenceIds: rows.map((row) => row.id) };
  });
}

async function validateKnowledgeClaimInput(
  input: CreateKnowledgeClaimInput,
): Promise<
  | "ok"
  | "project_not_found"
  | "workspace_mismatch"
  | "bundle_mismatch"
  | "concept_mismatch"
  | "edge_mismatch"
  | "chunk_mismatch"
> {
  const conceptIds = [
    input.subjectConceptId,
    input.objectConceptId,
  ].filter((value): value is string => Boolean(value));
  const uniqueConceptIds = [...new Set(conceptIds)];
  const edgeEvidence = input.edgeEvidence ?? [];
  const edgeIds = [...new Set(edgeEvidence.map((entry) => entry.conceptEdgeId))];
  const chunkIds = [...new Set(edgeEvidence.map((entry) => entry.noteChunkId))];

  const [
    [project],
    [bundle],
    conceptRows,
    edgeRows,
    bundleChunkRows,
  ] = await Promise.all([
    db
      .select({ workspaceId: projects.workspaceId })
      .from(projects)
      .where(eq(projects.id, input.projectId)),
    db
      .select({ id: evidenceBundles.id })
      .from(evidenceBundles)
      .where(
        and(
          eq(evidenceBundles.id, input.evidenceBundleId),
          eq(evidenceBundles.workspaceId, input.workspaceId),
          eq(evidenceBundles.projectId, input.projectId),
        ),
      ),
    uniqueConceptIds.length > 0
      ? db
          .select({ id: concepts.id })
          .from(concepts)
          .where(
            and(
              inArray(concepts.id, uniqueConceptIds),
              eq(concepts.projectId, input.projectId),
            ),
          )
      : Promise.resolve([]),
    edgeIds.length > 0
      ? db
          .select({
            id: conceptEdges.id,
            sourceId: conceptEdges.sourceId,
            targetId: conceptEdges.targetId,
          })
          .from(conceptEdges)
          .where(inArray(conceptEdges.id, edgeIds))
      : Promise.resolve([]),
    chunkIds.length > 0
      ? db
          .select({ noteChunkId: evidenceBundleChunks.noteChunkId })
          .from(evidenceBundleChunks)
          .innerJoin(
            noteChunks,
            eq(noteChunks.id, evidenceBundleChunks.noteChunkId),
          )
          .innerJoin(notes, eq(notes.id, evidenceBundleChunks.noteId))
          .where(
            and(
              eq(evidenceBundleChunks.bundleId, input.evidenceBundleId),
              inArray(evidenceBundleChunks.noteChunkId, chunkIds),
              eq(noteChunks.workspaceId, input.workspaceId),
              eq(noteChunks.projectId, input.projectId),
              isNull(noteChunks.deletedAt),
              isNull(notes.deletedAt),
            ),
          )
      : Promise.resolve([]),
  ]);

  if (!project) return "project_not_found";
  if (project.workspaceId !== input.workspaceId) return "workspace_mismatch";
  if (!bundle) return "bundle_mismatch";

  if (conceptRows.length !== uniqueConceptIds.length) {
    return "concept_mismatch";
  }

  if (edgeEvidence.length === 0) return "ok";

  if (edgeRows.length !== edgeIds.length) return "edge_mismatch";

  const edgeConceptIds = [
    ...new Set(edgeRows.flatMap((row) => [row.sourceId, row.targetId])),
  ];
  const edgeConceptRows = await db
    .select({ id: concepts.id })
    .from(concepts)
    .where(
      and(
        inArray(concepts.id, edgeConceptIds),
        eq(concepts.projectId, input.projectId),
      ),
    );
  if (edgeConceptRows.length !== edgeConceptIds.length) {
    return "edge_mismatch";
  }

  if (new Set(bundleChunkRows.map((row) => row.noteChunkId)).size !== chunkIds.length) {
    return "chunk_mismatch";
  }

  return "ok";
}
