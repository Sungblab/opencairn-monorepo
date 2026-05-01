import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  conceptEdgeEvidence,
  conceptExtractionChunks,
  conceptExtractions,
  evidenceBundleChunks,
  evidenceBundles,
  knowledgeClaims,
} from "../src/schema/evidence";

describe("evidence schema", () => {
  it("defines evidence bundle tables", () => {
    expect(Object.keys(getTableColumns(evidenceBundles))).toEqual(
      expect.arrayContaining(["id", "workspaceId", "projectId", "purpose"]),
    );
    expect(Object.keys(getTableColumns(evidenceBundleChunks))).toEqual(
      expect.arrayContaining(["bundleId", "noteChunkId", "quote", "citation"]),
    );
  });

  it("defines extraction and edge evidence tables", () => {
    expect(Object.keys(getTableColumns(conceptExtractions))).toContain(
      "evidenceBundleId",
    );
    expect(Object.keys(getTableColumns(conceptExtractionChunks))).toContain(
      "noteChunkId",
    );
    expect(Object.keys(getTableColumns(knowledgeClaims))).toContain("claimText");
    expect(Object.keys(getTableColumns(conceptEdgeEvidence))).toContain(
      "stance",
    );
  });
});
