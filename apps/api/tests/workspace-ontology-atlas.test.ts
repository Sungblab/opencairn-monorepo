import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/app.js";
import {
  db,
  concepts,
  conceptEdges,
  conceptExtractionChunks,
  conceptNotes,
  conceptExtractions,
  evidenceBundles,
  noteChunks,
  projects,
  notes,
  projectTreeNodes,
  user,
  wikiLinks,
  eq,
} from "@opencairn/db";
import { labelFromId } from "../src/lib/tree-queries.js";
import { createUser, seedWorkspace, type SeedResult } from "./helpers/seed.js";
import { signSessionCookie } from "./helpers/session.js";

const { workflowStartSpy } = vi.hoisted(() => ({
  workflowStartSpy: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../src/lib/temporal-client.js", () => ({
  getTemporalClient: vi.fn().mockResolvedValue({
    workflow: {
      start: workflowStartSpy,
    },
  }),
  taskQueue: () => "test-queue",
}));

const app = createApp();

describe("GET /api/workspaces/:workspaceId/ontology-atlas", () => {
  let ctx: SeedResult | null = null;

  beforeEach(() => {
    workflowStartSpy.mockClear();
  });

  afterEach(async () => {
    if (ctx) {
      await ctx.cleanup();
      ctx = null;
    }
  });

  it("groups same-named concepts across readable workspace projects", async () => {
    ctx = await seedWorkspace({ role: "editor" });
    const secondProjectId = randomUUID();
    await db.insert(projects).values({
      id: secondProjectId,
      workspaceId: ctx.workspaceId,
      name: "Second Project",
      createdBy: ctx.ownerUserId,
      defaultRole: "viewer",
    });

    const agentA = randomUUID();
    const rag = randomUUID();
    const agentB = randomUUID();
    await db.insert(concepts).values([
      {
        id: agentA,
        projectId: ctx.projectId,
        name: "AI Agents",
        description: "Agent system",
      },
      {
        id: rag,
        projectId: ctx.projectId,
        name: "RAG",
        description: "Retrieval",
      },
      {
        id: agentB,
        projectId: secondProjectId,
        name: "ai agents",
        description: "Same concept in another project",
      },
    ]);
    await db.insert(conceptEdges).values([
      {
        sourceId: agentA,
        targetId: rag,
        relationType: "depends-on",
        weight: 0.9,
      },
      {
        sourceId: agentB,
        targetId: rag,
        relationType: "supports",
        weight: 0.7,
      },
    ]);
    await db.insert(conceptNotes).values({
      conceptId: agentA,
      noteId: ctx.noteId,
    });
    await db
      .update(notes)
      .set({ updatedAt: new Date(Date.now() + 60_000) })
      .where(eq(notes.id, ctx.noteId));
    const linkedNoteId = randomUUID();
    await db.insert(notes).values({
      id: linkedNoteId,
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      title: "Linked Note",
      inheritParent: true,
    });
    await db.insert(wikiLinks).values({
      workspaceId: ctx.workspaceId,
      sourceNoteId: ctx.noteId,
      targetNoteId: linkedNoteId,
    });
    const bundleNodeId = randomUUID();
    await db.insert(projectTreeNodes).values({
      id: bundleNodeId,
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      parentId: null,
      kind: "source_bundle",
      label: "paper.pdf",
      icon: "file-pdf",
      path: labelFromId(bundleNodeId),
      metadata: {},
    });
    const artifactNodeId = randomUUID();
    await db.insert(projectTreeNodes).values({
      id: artifactNodeId,
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      parentId: bundleNodeId,
      kind: "artifact",
      label: "parsed.md",
      icon: "file-text",
      path: `${labelFromId(bundleNodeId)}.${labelFromId(artifactNodeId)}`,
      metadata: { role: "parsed_markdown" },
    });

    const res = await app.request(
      `/api/workspaces/${ctx.workspaceId}/ontology-atlas`,
      { headers: { cookie: await signSessionCookie(ctx.userId) } },
    );

    expect(res.status).toBe(200);
    const body = await res.json() as {
      nodes: Array<{
        label: string;
        normalizedName: string;
        bridge: boolean;
        duplicateCandidate: boolean;
        layer: string;
        objectType: string;
        stale: boolean;
        projectContexts: Array<{ projectId: string; projectName: string }>;
      }>;
      edges: Array<{
        relationType: string;
        crossProject: boolean;
        edgeType: string;
        layer: string;
        stale: boolean;
      }>;
      selection: string;
      readableProjectCount: number;
    };
    expect(body.selection).toBe("bridge-first");
    expect(body.readableProjectCount).toBe(2);
    const agent = body.nodes.find((node) => node.normalizedName === "ai agents");
    expect(agent?.bridge).toBe(true);
    expect(agent?.duplicateCandidate).toBe(true);
    expect(agent?.layer).toBe("ai");
    expect(agent?.objectType).toBe("concept");
    expect(agent?.stale).toBe(true);
    expect(agent?.projectContexts.map((project) => project.projectId).sort()).toEqual(
      [ctx.projectId, secondProjectId].sort(),
    );
    expect(body.nodes.some((node) => node.objectType === "note")).toBe(true);
    expect(body.nodes.some((node) => node.objectType === "source_bundle")).toBe(true);
    expect(body.edges.map((edge) => edge.relationType)).toEqual(
      expect.arrayContaining(["depends-on", "supports", "links-to"]),
    );
    expect(body.edges.map((edge) => edge.edgeType)).toEqual(
      expect.arrayContaining(["ai_relation", "wiki_link", "project_tree"]),
    );
  });

  it("rejects users outside the workspace", async () => {
    ctx = await seedWorkspace({ role: "editor" });
    const outsider = await createUser();
    try {
      const res = await app.request(
        `/api/workspaces/${ctx.workspaceId}/ontology-atlas`,
        { headers: { cookie: await signSessionCookie(outsider.id) } },
      );

      expect(res.status).toBe(403);
    } finally {
      await db.delete(user).where(eq(user.id, outsider.id));
    }
  });

  it("uses compiler extraction evidence as the concept freshness boundary", async () => {
    ctx = await seedWorkspace({ role: "editor" });
    const conceptId = randomUUID();
    await db.insert(concepts).values({
      id: conceptId,
      projectId: ctx.projectId,
      name: "Fresh Concept",
      description: "Compiler evidence should clear stale state",
    });
    await db.insert(conceptNotes).values({
      conceptId,
      noteId: ctx.noteId,
    });
    const noteUpdatedAt = new Date(Date.now() + 60_000);
    await db
      .update(notes)
      .set({ updatedAt: noteUpdatedAt })
      .where(eq(notes.id, ctx.noteId));
    const [bundle] = await db
      .insert(evidenceBundles)
      .values({
        workspaceId: ctx.workspaceId,
        projectId: ctx.projectId,
        purpose: "concept_extraction",
        producerKind: "agent",
        producerRunId: "compiler-refresh-test",
        tool: "compiler",
        createdBy: ctx.userId,
        createdAt: new Date(noteUpdatedAt.getTime() + 60_000),
      })
      .returning({ id: evidenceBundles.id });
    await db.insert(conceptExtractions).values({
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      conceptId,
      name: "Fresh Concept",
      kind: "concept",
      normalizedName: "fresh concept",
      description: "Compiler evidence should clear stale state",
      confidence: 0.9,
      evidenceBundleId: bundle.id,
      sourceNoteId: ctx.noteId,
      createdByRunId: "compiler-refresh-test",
      createdAt: new Date(noteUpdatedAt.getTime() + 60_000),
    });

    const res = await app.request(
      `/api/workspaces/${ctx.workspaceId}/ontology-atlas`,
      { headers: { cookie: await signSessionCookie(ctx.userId) } },
    );

    expect(res.status).toBe(200);
    const body = await res.json() as {
      nodes: Array<{ normalizedName: string; stale: boolean }>;
    };
    expect(
      body.nodes.find((node) => node.normalizedName === "fresh concept")?.stale,
    ).toBe(false);
  });

  it("surfaces chunk-backed source membership between extracted concepts", async () => {
    ctx = await seedWorkspace({ role: "editor" });
    const sourceConceptId = randomUUID();
    const targetConceptId = randomUUID();
    await db.insert(concepts).values([
      {
        id: sourceConceptId,
        projectId: ctx.projectId,
        name: "Memory Management",
        description: "Allocates runtime memory",
      },
      {
        id: targetConceptId,
        projectId: ctx.projectId,
        name: "Garbage Collection",
        description: "Reclaims unused objects",
      },
    ]);
    await db.insert(conceptNotes).values([
      {
        conceptId: sourceConceptId,
        noteId: ctx.noteId,
      },
      {
        conceptId: targetConceptId,
        noteId: ctx.noteId,
      },
    ]);
    const noteChunkId = randomUUID();
    await db.insert(noteChunks).values({
      id: noteChunkId,
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      noteId: ctx.noteId,
      chunkIndex: 0,
      headingPath: "Runtime memory",
      contextText: "Runtime memory",
      contentText: "Memory management and garbage collection share one source span.",
      tokenCount: 9,
      sourceOffsets: { start: 0, end: 64 },
      contentHash: `atlas-source-${noteChunkId}`,
    });
    const [bundle] = await db
      .insert(evidenceBundles)
      .values({
        workspaceId: ctx.workspaceId,
        projectId: ctx.projectId,
        purpose: "concept_extraction",
        producerKind: "agent",
        producerRunId: "compiler-source-membership-test",
        tool: "compiler",
        createdBy: ctx.userId,
      })
      .returning({ id: evidenceBundles.id });
    const extractionRows = await db
      .insert(conceptExtractions)
      .values([
        {
          workspaceId: ctx.workspaceId,
          projectId: ctx.projectId,
          conceptId: sourceConceptId,
          name: "Memory Management",
          kind: "concept",
          normalizedName: "memory management",
          description: "Allocates runtime memory",
          confidence: 0.9,
          evidenceBundleId: bundle.id,
          sourceNoteId: ctx.noteId,
          createdByRunId: "compiler-source-membership-test",
        },
        {
          workspaceId: ctx.workspaceId,
          projectId: ctx.projectId,
          conceptId: targetConceptId,
          name: "Garbage Collection",
          kind: "concept",
          normalizedName: "garbage collection",
          description: "Reclaims unused objects",
          confidence: 0.9,
          evidenceBundleId: bundle.id,
          sourceNoteId: ctx.noteId,
          createdByRunId: "compiler-source-membership-test",
        },
      ])
      .returning({ id: conceptExtractions.id });
    await db.insert(conceptExtractionChunks).values(
      extractionRows.map((row) => ({
        extractionId: row.id,
        noteChunkId,
        supportScore: 0.9,
        quote: "Memory management and garbage collection share one source span.",
      })),
    );

    const res = await app.request(
      `/api/workspaces/${ctx.workspaceId}/ontology-atlas`,
      { headers: { cookie: await signSessionCookie(ctx.userId) } },
    );

    expect(res.status).toBe(200);
    const body = await res.json() as {
      edges: Array<{
        edgeType: string;
        relationType: string;
        sourceNoteIds: string[];
        projectIds: string[];
      }>;
    };
    expect(body.edges).toContainEqual(
      expect.objectContaining({
        edgeType: "source_membership",
        relationType: "source-proximity",
        sourceNoteIds: [ctx.noteId],
        projectIds: [ctx.projectId],
      }),
    );
  });

  it("queues explicit refresh for stale source notes", async () => {
    ctx = await seedWorkspace({ role: "editor" });

    const res = await app.request(
      `/api/workspaces/${ctx.workspaceId}/ontology-atlas/refresh`,
      {
        method: "POST",
        headers: {
          cookie: await signSessionCookie(ctx.userId),
          "content-type": "application/json",
        },
        body: JSON.stringify({ noteIds: [ctx.noteId] }),
      },
    );

    expect(res.status).toBe(202);
    const body = await res.json() as {
      queuedNoteAnalysisJobs: number;
      compilerWorkflowIds: string[];
    };
    expect(body.queuedNoteAnalysisJobs).toBe(1);
    expect(body.compilerWorkflowIds).toHaveLength(1);
    expect(body.compilerWorkflowIds[0]).toMatch(
      new RegExp(`^compiler-refresh-${ctx.noteId}-`),
    );
    expect(workflowStartSpy).toHaveBeenCalledWith(
      "CompilerWorkflow",
      expect.objectContaining({
        taskQueue: "test-queue",
        workflowId: body.compilerWorkflowIds[0],
        args: [
          expect.objectContaining({
            note_id: ctx.noteId,
            project_id: ctx.projectId,
            workspace_id: ctx.workspaceId,
            user_id: ctx.userId,
          }),
        ],
      }),
    );
  });

  it("keeps high-scoring concepts when explicit nodes exceed the response limit", async () => {
    ctx = await seedWorkspace({ role: "editor" });
    const secondProjectId = randomUUID();
    await db.insert(projects).values({
      id: secondProjectId,
      workspaceId: ctx.workspaceId,
      name: "Second Project",
      createdBy: ctx.ownerUserId,
      defaultRole: "viewer",
    });
    await db.insert(concepts).values([
      {
        id: randomUUID(),
        projectId: ctx.projectId,
        name: "Workspace Atlas",
        description: "Important bridge",
      },
      {
        id: randomUUID(),
        projectId: secondProjectId,
        name: "workspace atlas",
        description: "Same bridge in another project",
      },
    ]);
    await db.insert(notes).values(
      Array.from({ length: 30 }, (_, index) => ({
        id: randomUUID(),
        workspaceId: ctx!.workspaceId,
        projectId: ctx!.projectId,
        title: `Recent explicit note ${index}`,
        inheritParent: true,
      })),
    );

    const res = await app.request(
      `/api/workspaces/${ctx.workspaceId}/ontology-atlas?limit=25`,
      { headers: { cookie: await signSessionCookie(ctx.userId) } },
    );

    expect(res.status).toBe(200);
    const body = await res.json() as {
      nodes: Array<{
        normalizedName: string;
        objectType: string;
        bridge: boolean;
      }>;
    };
    expect(body.nodes).toHaveLength(25);
    expect(body.nodes).toContainEqual(
      expect.objectContaining({
        normalizedName: "workspace atlas",
        objectType: "concept",
        bridge: true,
      }),
    );
  });
});
