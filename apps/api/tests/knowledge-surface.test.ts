import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  conceptEdgeEvidence,
  conceptEdges,
  conceptExtractionChunks,
  conceptExtractions,
  conceptNotes,
  concepts,
  db,
  evidenceBundleChunks,
  evidenceBundles,
  eq,
  knowledgeClaims,
  noteChunks,
  notes,
  wikiLinks,
} from "@opencairn/db";
import { createApp } from "../src/app.js";
import { seedWorkspace, type SeedResult } from "./helpers/seed.js";
import { signSessionCookie } from "./helpers/session.js";

const app = createApp();

async function seedSupportedEdge(ctx: SeedResult): Promise<{
  edgeId: string;
  bundleId: string;
  chunkId: string;
  sourceConceptId: string;
  targetConceptId: string;
}> {
  const [source] = await db
    .insert(concepts)
    .values({
      projectId: ctx.projectId,
      name: `Source ${randomUUID()}`,
      description: "queryable source concept",
    })
    .returning({ id: concepts.id });
  const [target] = await db
    .insert(concepts)
    .values({
      projectId: ctx.projectId,
      name: `Target ${randomUUID()}`,
      description: "target concept",
    })
    .returning({ id: concepts.id });
  const [edge] = await db
    .insert(conceptEdges)
    .values({
      sourceId: source.id,
      targetId: target.id,
      relationType: "supports",
      weight: 0.8,
    })
    .returning({ id: conceptEdges.id });

  await db
    .update(notes)
    .set({ type: "source", sourceType: "pdf" })
    .where(eq(notes.id, ctx.noteId));
  const chunkId = randomUUID();
  await db.insert(noteChunks).values({
    id: chunkId,
    workspaceId: ctx.workspaceId,
    projectId: ctx.projectId,
    noteId: ctx.noteId,
    chunkIndex: 0,
    headingPath: "Evidence",
    contentText: "This paragraph supports the edge.",
    tokenCount: 6,
    sourceOffsets: { start: 0, end: 33 },
    contentHash: `hash-${chunkId}`,
  });
  const [bundle] = await db
    .insert(evidenceBundles)
    .values({
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      purpose: "kg_edge",
      producerKind: "worker",
      createdBy: null,
    })
    .returning({ id: evidenceBundles.id });
  await db.insert(evidenceBundleChunks).values({
    bundleId: bundle.id,
    noteChunkId: chunkId,
    noteId: ctx.noteId,
    rank: 1,
    score: 0.9,
    retrievalChannel: "graph",
    headingPath: "Evidence",
    sourceOffsets: { start: 0, end: 33 },
    quote: "This paragraph supports the edge.",
    citation: { label: "S1", title: "Source" },
    metadata: {},
  });
  const [claim] = await db
    .insert(knowledgeClaims)
    .values({
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      claimText: "Source supports target.",
      claimType: "relation",
      subjectConceptId: source.id,
      objectConceptId: target.id,
      status: "active",
      confidence: 0.9,
      evidenceBundleId: bundle.id,
      producedBy: "ingest",
    })
    .returning({ id: knowledgeClaims.id });
  await db.insert(conceptEdgeEvidence).values({
    conceptEdgeId: edge.id,
    claimId: claim.id,
    evidenceBundleId: bundle.id,
    noteChunkId: chunkId,
    supportScore: 0.9,
    stance: "supports",
    quote: "This paragraph supports the edge.",
  });

  return {
    edgeId: edge.id,
    bundleId: bundle.id,
    chunkId,
    sourceConceptId: source.id,
    targetConceptId: target.id,
  };
}

describe("GET /api/projects/:projectId/knowledge-surface", () => {
  let ctx: SeedResult;
  let outsider: SeedResult;

  beforeEach(async () => {
    ctx = await seedWorkspace({ role: "owner" });
    outsider = await seedWorkspace({ role: "owner" });
  });

  afterEach(async () => {
    await ctx.cleanup();
    await outsider.cleanup();
  });

  it("returns graph edges with support summaries and optional evidence bundles", async () => {
    const seeded = await seedSupportedEdge(ctx);
    const res = await app.request(
      `/api/projects/${ctx.projectId}/knowledge-surface?view=graph&includeEvidence=true`,
      { headers: { cookie: await signSessionCookie(ctx.userId) } },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      viewType: string;
      edges: Array<{ id: string; support: { status: string; citationCount: number } }>;
      evidenceBundles?: Array<{ id: string }>;
    };
    expect(body.viewType).toBe("graph");
    expect(body.edges.find((edge) => edge.id === seeded.edgeId)?.support).toMatchObject({
      status: "supported",
      citationCount: 1,
    });
    expect(body.evidenceBundles?.map((bundle) => bundle.id)).toContain(seeded.bundleId);
  });

  it("adds display-only co-mention edges for concepts that share a source note", async () => {
    const seeded = await seedSupportedEdge(ctx);
    await db.insert(conceptNotes).values([
      { conceptId: seeded.sourceConceptId, noteId: ctx.noteId },
      { conceptId: seeded.targetConceptId, noteId: ctx.noteId },
    ]);

    const res = await app.request(
      `/api/projects/${ctx.projectId}/knowledge-surface?view=graph`,
      { headers: { cookie: await signSessionCookie(ctx.userId) } },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      edges: Array<{
        relationType: string;
        surfaceType?: string;
        displayOnly?: boolean;
        sourceNoteIds?: string[];
        sourceNotes?: Array<{ id: string; title: string }>;
        sourceNoteLinks?: Array<{
          sourceNoteId: string;
          sourceTitle: string;
          targetNoteId: string;
          targetTitle: string;
        }>;
      }>;
    };
    expect(body.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relationType: "co-mention",
          surfaceType: "co_mention",
          displayOnly: true,
          sourceNoteIds: [ctx.noteId],
          sourceNotes: [expect.objectContaining({ id: ctx.noteId })],
        }),
      ]),
    );
  });

  it("projects explicit wiki links into knowledge surface edges", async () => {
    const seeded = await seedSupportedEdge(ctx);
    const [targetNote] = await db
      .insert(notes)
      .values({
        projectId: ctx.projectId,
        workspaceId: ctx.workspaceId,
        title: "Linked wiki note",
        type: "wiki",
        inheritParent: true,
      })
      .returning({ id: notes.id });
    await db.insert(conceptNotes).values([
      { conceptId: seeded.sourceConceptId, noteId: ctx.noteId },
      { conceptId: seeded.targetConceptId, noteId: targetNote.id },
    ]);
    await db.insert(wikiLinks).values({
      workspaceId: ctx.workspaceId,
      sourceNoteId: ctx.noteId,
      targetNoteId: targetNote.id,
    });
    const [unmappedSource] = await db
      .insert(notes)
      .values({
        projectId: ctx.projectId,
        workspaceId: ctx.workspaceId,
        title: "Unmapped source",
        type: "wiki",
        inheritParent: true,
      })
      .returning({ id: notes.id });
    const [unmappedTarget] = await db
      .insert(notes)
      .values({
        projectId: ctx.projectId,
        workspaceId: ctx.workspaceId,
        title: "Unmapped target",
        type: "wiki",
        inheritParent: true,
      })
      .returning({ id: notes.id });
    await db.insert(wikiLinks).values({
      workspaceId: ctx.workspaceId,
      sourceNoteId: unmappedSource.id,
      targetNoteId: unmappedTarget.id,
    });

    const res = await app.request(
      `/api/projects/${ctx.projectId}/knowledge-surface?view=graph`,
      { headers: { cookie: await signSessionCookie(ctx.userId) } },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      edges: Array<{
        relationType: string;
        surfaceType?: string;
        displayOnly?: boolean;
        sourceNoteIds?: string[];
        sourceNotes?: Array<{ id: string; title: string }>;
        sourceNoteLinks?: Array<{
          sourceNoteId: string;
          sourceTitle: string;
          targetNoteId: string;
          targetTitle: string;
        }>;
      }>;
      noteLinks?: Array<{
        sourceNoteId: string;
        sourceTitle: string;
        targetNoteId: string;
        targetTitle: string;
      }>;
    };
    expect(body.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relationType: "wiki-link",
          surfaceType: "wiki_link",
          displayOnly: true,
          sourceNoteIds: expect.arrayContaining([ctx.noteId, targetNote.id]),
          sourceNotes: expect.arrayContaining([
            expect.objectContaining({ id: targetNote.id, title: "Linked wiki note" }),
          ]),
          sourceNoteLinks: [
            {
              sourceNoteId: ctx.noteId,
              sourceTitle: "test",
              targetNoteId: targetNote.id,
              targetTitle: "Linked wiki note",
            },
          ],
        }),
      ]),
    );
    expect(body.noteLinks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceNoteId: unmappedSource.id,
          sourceTitle: "Unmapped source",
          targetNoteId: unmappedTarget.id,
          targetTitle: "Unmapped target",
        }),
      ]),
    );
  });

  it("returns explicit note links for timeline even when concepts are absent", async () => {
    const [sourceNote] = await db
      .insert(notes)
      .values({
        projectId: ctx.projectId,
        workspaceId: ctx.workspaceId,
        title: "Timeline source",
        type: "wiki",
        inheritParent: true,
      })
      .returning({ id: notes.id });
    const [targetNote] = await db
      .insert(notes)
      .values({
        projectId: ctx.projectId,
        workspaceId: ctx.workspaceId,
        title: "Timeline target",
        type: "wiki",
        inheritParent: true,
      })
      .returning({ id: notes.id });
    await db.insert(wikiLinks).values({
      workspaceId: ctx.workspaceId,
      sourceNoteId: sourceNote.id,
      targetNoteId: targetNote.id,
    });

    const res = await app.request(
      `/api/projects/${ctx.projectId}/knowledge-surface?view=timeline`,
      { headers: { cookie: await signSessionCookie(ctx.userId) } },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      viewType: string;
      noteLinks?: Array<{
        sourceNoteId: string;
        sourceTitle: string;
        targetNoteId: string;
        targetTitle: string;
      }>;
    };
    expect(body.viewType).toBe("timeline");
    expect(body.noteLinks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceNoteId: sourceNote.id,
          sourceTitle: "Timeline source",
          targetNoteId: targetNote.id,
          targetTitle: "Timeline target",
        }),
      ]),
    );
  });

  it("filters explicit note links by query", async () => {
    const [matchingSource] = await db
      .insert(notes)
      .values({
        projectId: ctx.projectId,
        workspaceId: ctx.workspaceId,
        title: "Query match source",
        type: "wiki",
        inheritParent: true,
      })
      .returning({ id: notes.id });
    const [matchingTarget] = await db
      .insert(notes)
      .values({
        projectId: ctx.projectId,
        workspaceId: ctx.workspaceId,
        title: "Linked target",
        type: "wiki",
        inheritParent: true,
      })
      .returning({ id: notes.id });
    const [otherSource] = await db
      .insert(notes)
      .values({
        projectId: ctx.projectId,
        workspaceId: ctx.workspaceId,
        title: "Other source",
        type: "wiki",
        inheritParent: true,
      })
      .returning({ id: notes.id });
    const [otherTarget] = await db
      .insert(notes)
      .values({
        projectId: ctx.projectId,
        workspaceId: ctx.workspaceId,
        title: "Other target",
        type: "wiki",
        inheritParent: true,
      })
      .returning({ id: notes.id });
    await db.insert(wikiLinks).values([
      {
        workspaceId: ctx.workspaceId,
        sourceNoteId: matchingSource.id,
        targetNoteId: matchingTarget.id,
      },
      {
        workspaceId: ctx.workspaceId,
        sourceNoteId: otherSource.id,
        targetNoteId: otherTarget.id,
      },
    ]);

    const res = await app.request(
      `/api/projects/${ctx.projectId}/knowledge-surface?view=timeline&query=match`,
      { headers: { cookie: await signSessionCookie(ctx.userId) } },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      noteLinks?: Array<{
        sourceNoteId: string;
        sourceTitle: string;
        targetNoteId: string;
        targetTitle: string;
      }>;
    };
    expect(body.noteLinks).toEqual([
      {
        sourceNoteId: matchingSource.id,
        sourceTitle: "Query match source",
        targetNoteId: matchingTarget.id,
        targetTitle: "Linked target",
      },
    ]);
  });

  it("projects same-chunk source proximity into knowledge surface edges", async () => {
    const seeded = await seedSupportedEdge(ctx);
    const [sourceExtraction] = await db
      .insert(conceptExtractions)
      .values({
        workspaceId: ctx.workspaceId,
        projectId: ctx.projectId,
        conceptId: seeded.sourceConceptId,
        name: "Source proximity concept",
        kind: "concept",
        normalizedName: "source proximity concept",
        description: "Extracted from the same source chunk.",
        confidence: 0.9,
        evidenceBundleId: seeded.bundleId,
        sourceNoteId: ctx.noteId,
      })
      .returning({ id: conceptExtractions.id });
    const [targetExtraction] = await db
      .insert(conceptExtractions)
      .values({
        workspaceId: ctx.workspaceId,
        projectId: ctx.projectId,
        conceptId: seeded.targetConceptId,
        name: "Target proximity concept",
        kind: "concept",
        normalizedName: "target proximity concept",
        description: "Extracted from the same source chunk.",
        confidence: 0.88,
        evidenceBundleId: seeded.bundleId,
        sourceNoteId: ctx.noteId,
      })
      .returning({ id: conceptExtractions.id });
    await db.insert(conceptExtractionChunks).values([
      {
        extractionId: sourceExtraction.id,
        noteChunkId: seeded.chunkId,
        supportScore: 0.93,
        quote: "source quote",
      },
      {
        extractionId: targetExtraction.id,
        noteChunkId: seeded.chunkId,
        supportScore: 0.91,
        quote: "target quote",
      },
    ]);

    const res = await app.request(
      `/api/projects/${ctx.projectId}/knowledge-surface?view=graph`,
      { headers: { cookie: await signSessionCookie(ctx.userId) } },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      edges: Array<{
        relationType: string;
        surfaceType?: string;
        displayOnly?: boolean;
        sourceNoteIds?: string[];
        sourceNotes?: Array<{ id: string; title: string }>;
        sourceContexts?: Array<{
          noteId: string;
          noteTitle: string;
          chunkId: string;
          headingPath: string;
          chunkIndex: number;
        }>;
      }>;
    };
    expect(body.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relationType: "source-proximity",
          surfaceType: "source_membership",
          displayOnly: true,
          sourceNoteIds: [ctx.noteId],
          sourceNotes: [expect.objectContaining({ id: ctx.noteId })],
          sourceContexts: expect.arrayContaining([
            expect.objectContaining({
              noteId: ctx.noteId,
              chunkId: seeded.chunkId,
              headingPath: "Evidence",
              chunkIndex: 0,
            }),
          ]),
        }),
      ]),
    );
  });

  it("returns cards backed by concept claim evidence", async () => {
    const seeded = await seedSupportedEdge(ctx);
    const res = await app.request(
      `/api/projects/${ctx.projectId}/knowledge-surface?view=cards`,
      { headers: { cookie: await signSessionCookie(ctx.userId) } },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      viewType: string;
      cards: Array<{ conceptId: string; evidenceBundleId: string | null; citationCount: number }>;
    };
    expect(body.viewType).toBe("cards");
    const card = body.cards.find((item) => item.conceptId === seeded.sourceConceptId);
    expect(card?.evidenceBundleId).toBe(seeded.bundleId);
    expect(card?.citationCount).toBe(1);

    const objectCard = body.cards.find(
      (item) => item.conceptId === seeded.targetConceptId,
    );
    expect(objectCard?.evidenceBundleId).toBe(seeded.bundleId);
    expect(objectCard?.citationCount).toBe(1);
  });

  it("does not expose knowledge surfaces to non-members", async () => {
    await seedSupportedEdge(ctx);
    const res = await app.request(
      `/api/projects/${ctx.projectId}/knowledge-surface?view=graph`,
      { headers: { cookie: await signSessionCookie(outsider.userId) } },
    );

    expect(res.status).toBe(403);
  });
});
