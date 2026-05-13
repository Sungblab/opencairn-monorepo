import { describe, expect, it } from "vitest";
import { extractAgentActionFence } from "../src/agent-action-fence";

describe("agent action fence", () => {
  it("extracts typed agent actions from the last valid fence", () => {
    const extracted = extractAgentActionFence([
      "I'll prepare that.",
      "```agent-actions",
      JSON.stringify({
        actions: [
          {
            kind: "note.create",
            risk: "write",
            input: { title: "Project brief", folderId: null },
          },
        ],
      }),
      "```",
    ].join("\n"));

    expect(extracted).toEqual({
      actions: [
        {
          kind: "note.create",
          risk: "write",
          approvalMode: "auto_safe",
          input: { title: "Project brief", folderId: null },
        },
      ],
    });
  });

  it("rejects LLM-supplied trusted scope fields", () => {
    const extracted = extractAgentActionFence([
      "```agent-actions",
      JSON.stringify({
        actions: [
          {
            kind: "note.create",
            risk: "write",
            input: {
              title: "Bad",
              projectId: "00000000-0000-4000-8000-000000000002",
            },
          },
        ],
      }),
      "```",
    ].join("\n"));

    expect(extracted).toBeNull();
  });

  it("accepts a typed markdown note creation action", () => {
    const extracted = extractAgentActionFence([
      "```agent-actions",
      JSON.stringify({
        actions: [
          {
            kind: "note.create_from_markdown",
            risk: "write",
            input: {
              title: "PDF 요약 노트",
              folderId: null,
              bodyMarkdown: "# PDF 요약\n\n- 핵심 개념",
            },
          },
        ],
      }),
      "```",
    ].join("\n"));

    expect(extracted).toEqual({
      actions: [
        {
          kind: "note.create_from_markdown",
          risk: "write",
          approvalMode: "auto_safe",
          input: {
            title: "PDF 요약 노트",
            folderId: null,
            bodyMarkdown: "# PDF 요약\n\n- 핵심 개념",
          },
        },
      ],
    });
  });

  it("repairs a missing trailing top-level object brace from model output", () => {
    const extracted = extractAgentActionFence([
      "```agent-actions",
      [
        "{\"actions\":[{\"kind\":\"note.create_from_markdown\",",
        "\"risk\":\"write\",",
        "\"input\":{\"title\":\"PDF 요약 노트\",\"folderId\":null,",
        "\"bodyMarkdown\":\"# PDF 요약\\n\\n- 핵심 개념\"}}]",
      ].join(""),
      "```",
    ].join("\n"));

    expect(extracted).toEqual({
      actions: [
        {
          kind: "note.create_from_markdown",
          risk: "write",
          approvalMode: "auto_safe",
          input: {
            title: "PDF 요약 노트",
            folderId: null,
            bodyMarkdown: "# PDF 요약\n\n- 핵심 개념",
          },
        },
      ],
    });
  });

  it("repairs a missing trailing actions array bracket from model output", () => {
    const extracted = extractAgentActionFence([
      "```agent-actions",
      [
        "{\"actions\":[{\"kind\":\"note.create_from_markdown\",",
        "\"risk\":\"write\",",
        "\"input\":{\"title\":\"PDF 요약 노트\",\"folderId\":null,",
        "\"bodyMarkdown\":\"# PDF 요약\\n\\n- 핵심 개념\"}}}",
      ].join(""),
      "```",
    ].join("\n"));

    expect(extracted).toEqual({
      actions: [
        {
          kind: "note.create_from_markdown",
          risk: "write",
          approvalMode: "auto_safe",
          input: {
            title: "PDF 요약 노트",
            folderId: null,
            bodyMarkdown: "# PDF 요약\n\n- 핵심 개념",
          },
        },
      ],
    });
  });

  it("handles unterminated fences in linear time without regex backtracking", () => {
    const extracted = extractAgentActionFence(
      "```agent-actions\n" + "\n\t".repeat(10_000),
    );

    expect(extracted).toBeNull();
  });
});
