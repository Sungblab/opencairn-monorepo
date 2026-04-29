import { describe, it, expect, vi } from "vitest";
import {
  startSynthesisExportRun,
  signalSynthesisExportCancel,
  workflowIdFor,
} from "../../src/lib/synthesis-export-client.js";

describe("synthesis-export-client", () => {
  it("workflowIdFor wraps the run id with synthesis-export- prefix", () => {
    expect(workflowIdFor("abc")).toBe("synthesis-export-abc");
  });

  it("startSynthesisExportRun calls workflow.start with SynthesisExportWorkflow", async () => {
    const start = vi.fn().mockResolvedValue({ firstExecutionRunId: "x" });
    const fakeClient = { workflow: { start } } as unknown as Parameters<typeof startSynthesisExportRun>[0];

    await startSynthesisExportRun(fakeClient, {
      runId: "abc",
      workspaceId: "w",
      projectId: null,
      userId: "u",
      format: "md",
      template: "report",
      userPrompt: "x",
      explicitSourceIds: [],
      noteIds: [],
      autoSearch: false,
      byokKeyHandle: null,
    });

    expect(start).toHaveBeenCalledOnce();
    const [name, opts] = start.mock.calls[0]!;
    expect(name).toBe("SynthesisExportWorkflow");
    expect(opts.workflowId).toBe("synthesis-export-abc");
    // snake_case payload keys for python @dataclass round-trip
    expect(opts.args[0]).toMatchObject({
      run_id: "abc",
      workspace_id: "w",
      project_id: null,
      user_id: "u",
      format: "md",
      template: "report",
      user_prompt: "x",
      explicit_source_ids: [],
      note_ids: [],
      auto_search: false,
      byok_key_handle: null,
    });
  });

  it("signalSynthesisExportCancel resolves the handle and sends 'cancel'", async () => {
    const signal = vi.fn().mockResolvedValue(undefined);
    const getHandle = vi.fn().mockReturnValue({ signal });
    const fakeClient = { workflow: { getHandle } } as unknown as Parameters<typeof signalSynthesisExportCancel>[0];

    await signalSynthesisExportCancel(fakeClient, "abc");

    expect(getHandle).toHaveBeenCalledWith("synthesis-export-abc");
    expect(signal).toHaveBeenCalledWith("cancel");
  });
});
