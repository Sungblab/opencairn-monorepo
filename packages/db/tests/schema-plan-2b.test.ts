import { describe, it, expect } from "vitest";
import { getTableColumns } from "drizzle-orm";
import {
  comments,
  commentMentions,
  yjsDocuments,
  notes,
} from "../src/index";

describe("plan 2b schema", () => {
  it("comments has expected columns", () => {
    expect(Object.keys(getTableColumns(comments))).toEqual(
      expect.arrayContaining([
        "id",
        "workspaceId",
        "noteId",
        "parentId",
        "anchorBlockId",
        "authorId",
        "body",
        "bodyAst",
        "resolvedAt",
        "resolvedBy",
        "createdAt",
        "updatedAt",
      ])
    );
  });
  it("commentMentions PK covers (comment_id, type, id)", () => {
    const cols = getTableColumns(commentMentions);
    expect(cols.commentId).toBeDefined();
    expect(cols.mentionedType).toBeDefined();
    expect(cols.mentionedId).toBeDefined();
  });
  it("yjsDocuments stores binary state", () => {
    const cols = getTableColumns(yjsDocuments);
    expect(cols.name).toBeDefined();
    expect(cols.state).toBeDefined();
    expect(cols.stateVector).toBeDefined();
  });
  it("notes has yjs_state_loaded_at", () => {
    const cols = getTableColumns(notes);
    expect(cols.yjsStateLoadedAt).toBeDefined();
  });
});
