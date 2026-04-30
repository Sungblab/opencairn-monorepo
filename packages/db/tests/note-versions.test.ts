import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  noteVersionActorTypeEnum,
  noteVersionSourceEnum,
  noteVersions,
} from "../src";

describe("note_versions schema", () => {
  it("declares the note_versions table and required columns", () => {
    expect(getTableName(noteVersions)).toBe("note_versions");
    const cols = getTableColumns(noteVersions);
    expect(Object.keys(cols)).toEqual(
      expect.arrayContaining([
        "id",
        "noteId",
        "workspaceId",
        "projectId",
        "version",
        "title",
        "content",
        "contentText",
        "contentHash",
        "yjsState",
        "yjsStateVector",
        "actorId",
        "actorType",
        "source",
        "reason",
        "createdAt",
      ]),
    );
  });

  it("declares actor and source enums", () => {
    expect(noteVersionActorTypeEnum.enumValues).toEqual([
      "user",
      "agent",
      "system",
    ]);
    expect(noteVersionSourceEnum.enumValues).toEqual([
      "auto_save",
      "title_change",
      "ai_edit",
      "restore",
      "manual_checkpoint",
      "import",
    ]);
  });
});
