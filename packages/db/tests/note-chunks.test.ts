import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { noteChunks } from "../src/schema/note-chunks";

describe("noteChunks schema", () => {
  it("defines retrieval, citation, and soft-delete columns", () => {
    const columns = Object.keys(getTableColumns(noteChunks));

    expect(columns).toEqual(
      expect.arrayContaining([
        "id",
        "workspaceId",
        "projectId",
        "noteId",
        "chunkIndex",
        "headingPath",
        "contentText",
        "contentTsv",
        "embedding",
        "tokenCount",
        "sourceOffsets",
        "contentHash",
        "deletedAt",
        "createdAt",
        "updatedAt",
      ]),
    );
  });
});
