import { describe, expect, it } from "vitest";
import { buildFactcheckCommentRows } from "../src/lib/doc-editor-comments";

describe("buildFactcheckCommentRows", () => {
  it("uses the triggering user as author and stores agent metadata in bodyAst", () => {
    const rows = buildFactcheckCommentRows({
      workspaceId: "ws1",
      noteId: "n1",
      userId: "u1",
      claims: [
        {
          blockId: "b1",
          range: { start: 0, end: 12 },
          verdict: "contradicted",
          evidence: [
            {
              source_id: "source-1",
              snippet: "A source says otherwise.",
              confidence: 0.8,
            },
          ],
          note: "The available source contradicts this claim.",
        },
      ],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      workspaceId: "ws1",
      noteId: "n1",
      anchorBlockId: "b1",
      authorId: "u1",
      bodyAst: {
        agentKind: "doc_editor",
        command: "factcheck",
        verdict: "contradicted",
        triggeredBy: "u1",
      },
    });
    expect(rows[0]?.body).toContain("Contradicted");
  });
});
