import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  noteAnalysisJobs,
  noteAnalysisStatusEnum,
} from "../src/schema/note-analysis-jobs";

describe("noteAnalysisJobs schema", () => {
  it("tracks durable mutable-note analysis freshness state", () => {
    const columns = Object.keys(getTableColumns(noteAnalysisJobs));

    expect(noteAnalysisStatusEnum.enumValues).toEqual([
      "queued",
      "running",
      "completed",
      "failed",
    ]);
    expect(columns).toEqual(
      expect.arrayContaining([
        "id",
        "workspaceId",
        "projectId",
        "noteId",
        "contentHash",
        "yjsStateVector",
        "analysisVersion",
        "status",
        "runAfter",
        "lastQueuedAt",
        "lastStartedAt",
        "lastCompletedAt",
        "errorCode",
        "errorMessage",
        "createdAt",
        "updatedAt",
      ]),
    );
  });
});
