import { describe, it, expect } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { noteEnrichments } from "../src/schema/note-enrichments";

describe("note_enrichments schema (Spec B)", () => {
  it("exposes the columns the enrichment pipeline writes", () => {
    expect(Object.keys(getTableColumns(noteEnrichments))).toEqual(
      expect.arrayContaining([
        "id",
        "noteId",
        "workspaceId",
        "contentType",
        "status",
        "artifact",
        "provider",
        "skipReasons",
        "error",
        "createdAt",
        "updatedAt",
      ]),
    );
  });

  it("status defaults to pending", () => {
    const cols = getTableColumns(noteEnrichments);
    expect(cols.status.default).toBe("pending");
  });

  it("note_id and workspace_id are required (notNull)", () => {
    const cols = getTableColumns(noteEnrichments);
    expect(cols.noteId.notNull).toBe(true);
    expect(cols.workspaceId.notNull).toBe(true);
    expect(cols.contentType.notNull).toBe(true);
  });
});
