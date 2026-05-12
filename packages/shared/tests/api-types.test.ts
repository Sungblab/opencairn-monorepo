import { describe, expect, it } from "vitest";
import {
  createNoteSchema,
  patchCanvasSchema,
  canvasLanguageSchema,
  workspaceAtlasResponseSchema,
} from "../src/api-types";

describe("createNoteSchema (canvas extension)", () => {
  const baseValid = {
    projectId: "00000000-0000-0000-0000-000000000001",
  };

  it("rejects sourceType='canvas' without canvasLanguage", () => {
    const r = createNoteSchema.safeParse({ ...baseValid, sourceType: "canvas" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0].path).toContain("canvasLanguage");
      expect(r.error.issues[0].message).toBe(
        "canvasLanguage required when sourceType=canvas",
      );
    }
  });

  it("accepts non-canvas sourceType with stray canvasLanguage (DB CHECK enforces, not API)", () => {
    const r = createNoteSchema.safeParse({
      ...baseValid,
      sourceType: "manual",
      canvasLanguage: "python",
    });
    expect(r.success).toBe(true);
  });

  it("accepts sourceType='canvas' + canvasLanguage='python'", () => {
    const r = createNoteSchema.safeParse({
      ...baseValid,
      sourceType: "canvas",
      canvasLanguage: "python",
      contentText: "print('hi')",
    });
    expect(r.success).toBe(true);
  });

  it("contentText > 64KB rejected", () => {
    const r = createNoteSchema.safeParse({
      ...baseValid,
      sourceType: "canvas",
      canvasLanguage: "python",
      contentText: "a".repeat(64 * 1024 + 1),
    });
    expect(r.success).toBe(false);
  });

  it("works without canvas fields (backward compat)", () => {
    const r = createNoteSchema.safeParse(baseValid);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.title).toBe("");
    }
  });

  it("accepts a unified tree parent for child page creation", () => {
    const r = createNoteSchema.safeParse({
      ...baseValid,
      parentTreeNodeId: "00000000-0000-0000-0000-000000000002",
    });
    expect(r.success).toBe(true);
  });
});

describe("patchCanvasSchema", () => {
  it("accepts source + language", () => {
    const r = patchCanvasSchema.safeParse({ source: "x", language: "python" });
    expect(r.success).toBe(true);
  });

  it("source > 64KB rejected", () => {
    const r = patchCanvasSchema.safeParse({ source: "a".repeat(64 * 1024 + 1) });
    expect(r.success).toBe(false);
  });

  it("invalid language rejected", () => {
    const r = patchCanvasSchema.safeParse({ source: "x", language: "ruby" });
    expect(r.success).toBe(false);
  });

  it("accepts source without language (language is optional)", () => {
    const r = patchCanvasSchema.safeParse({ source: "x" });
    expect(r.success).toBe(true);
  });
});

describe("canvasLanguageSchema", () => {
  it("accepts 4 known languages", () => {
    expect(canvasLanguageSchema.safeParse("python").success).toBe(true);
    expect(canvasLanguageSchema.safeParse("javascript").success).toBe(true);
    expect(canvasLanguageSchema.safeParse("html").success).toBe(true);
    expect(canvasLanguageSchema.safeParse("react").success).toBe(true);
  });
});

describe("workspace atlas contracts", () => {
  it("accepts explicit and AI graph layers with freshness signals", () => {
    const parsed = workspaceAtlasResponseSchema.parse({
      workspaceId: "11111111-1111-4111-8111-111111111111",
      readableProjectCount: 1,
      totalConcepts: 1,
      truncated: false,
      selection: "bridge-first",
      nodes: [
        {
          id: "note:22222222-2222-4222-8222-222222222222",
          label: "Source Note",
          objectType: "note",
          layer: "explicit",
          normalizedName: "source note",
          conceptIds: [],
          sourceNoteIds: ["22222222-2222-4222-8222-222222222222"],
          projectContexts: [
            {
              projectId: "33333333-3333-4333-8333-333333333333",
              projectName: "Research",
              conceptIds: [],
              mentionCount: 0,
            },
          ],
          projectCount: 1,
          mentionCount: 0,
          degree: 1,
          bridge: false,
          duplicateCandidate: false,
          unclassified: false,
          stale: false,
        },
        {
          id: "concept:retrieval",
          label: "Retrieval",
          objectType: "concept",
          layer: "ai",
          normalizedName: "retrieval",
          conceptIds: ["44444444-4444-4444-8444-444444444444"],
          sourceNoteIds: ["22222222-2222-4222-8222-222222222222"],
          projectContexts: [
            {
              projectId: "33333333-3333-4333-8333-333333333333",
              projectName: "Research",
              conceptIds: ["44444444-4444-4444-8444-444444444444"],
              mentionCount: 1,
            },
          ],
          projectCount: 1,
          mentionCount: 1,
          degree: 1,
          bridge: false,
          duplicateCandidate: false,
          unclassified: false,
          stale: true,
          freshnessReason: "source_note_changed",
        },
      ],
      edges: [
        {
          id: "wiki:55555555-5555-4555-8555-555555555555",
          sourceId: "note:22222222-2222-4222-8222-222222222222",
          targetId: "note:66666666-6666-4666-8666-666666666666",
          edgeType: "wiki_link",
          layer: "explicit",
          relationType: "links-to",
          weight: 1,
          conceptEdgeIds: [],
          sourceNoteIds: ["22222222-2222-4222-8222-222222222222"],
          sourceNoteLinks: [
            {
              sourceNoteId: "22222222-2222-4222-8222-222222222222",
              sourceTitle: "Source Note",
              targetNoteId: "66666666-6666-4666-8666-666666666666",
              targetTitle: "Target Note",
            },
          ],
          projectIds: ["33333333-3333-4333-8333-333333333333"],
          crossProject: false,
          stale: false,
        },
        {
          id: "ai:77777777-7777-4777-8777-777777777777",
          sourceId: "concept:retrieval",
          targetId: "concept:indexing",
          edgeType: "ai_relation",
          layer: "ai",
          relationType: "supports",
          weight: 0.8,
          conceptEdgeIds: ["77777777-7777-4777-8777-777777777777"],
          sourceNoteIds: ["22222222-2222-4222-8222-222222222222"],
          projectIds: ["33333333-3333-4333-8333-333333333333"],
          crossProject: false,
          stale: true,
          freshnessReason: "source_note_changed",
        },
        {
          id: "source:concept%3Aretrieval->concept%3Aindexing",
          sourceId: "concept:retrieval",
          targetId: "concept:indexing",
          edgeType: "source_membership",
          layer: "ai",
          relationType: "source-proximity",
          weight: 1,
          conceptEdgeIds: [],
          sourceNoteIds: ["22222222-2222-4222-8222-222222222222"],
          projectIds: ["33333333-3333-4333-8333-333333333333"],
          crossProject: false,
          stale: false,
        },
      ],
    });

    expect(parsed.nodes.map((node) => node.layer)).toEqual([
      "explicit",
      "ai",
    ]);
    expect(parsed.edges.map((edge) => edge.edgeType)).toEqual([
      "wiki_link",
      "ai_relation",
      "source_membership",
    ]);
    expect(parsed.nodes[1].stale).toBe(true);
  });
});
