import { describe, it, expect } from "vitest";
import { docEditorCalls } from "../src/schema/doc-editor-calls";

describe("docEditorCalls schema", () => {
  it("declares the columns slash-command billing requires", () => {
    const cols = Object.keys(docEditorCalls);
    expect(cols).toEqual(
      expect.arrayContaining([
        "id",
        "noteId",
        "userId",
        "workspaceId",
        "command",
        "tokensIn",
        "tokensOut",
        "costKrw",
        "status",
        "errorCode",
        "createdAt",
      ]),
    );
  });
});
