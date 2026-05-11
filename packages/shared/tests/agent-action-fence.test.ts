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
});
