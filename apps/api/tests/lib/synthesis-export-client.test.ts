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
    const [name, opts] = start.mock.calls[0];
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
    // Lock the exact key set so a future field rename on either side
    // surfaces as a test failure rather than a silent payload mismatch.
    expect(Object.keys(opts.args[0]).sort()).toEqual(
      [
        "auto_search",
        "byok_key_handle",
        "explicit_source_ids",
        "format",
        "note_ids",
        "project_id",
        "run_id",
        "template",
        "user_id",
        "user_prompt",
        "workspace_id",
      ].sort(),
    );
  });

  it("respects SYNTHESIS_EXPORT_TIMEOUT_MS env override", async () => {
    const original = process.env.SYNTHESIS_EXPORT_TIMEOUT_MS;
    process.env.SYNTHESIS_EXPORT_TIMEOUT_MS = "300000";
    try {
      const start = vi.fn().mockResolvedValue({ firstExecutionRunId: "x" });
      const fakeClient = { workflow: { start } } as unknown as Parameters<typeof startSynthesisExportRun>[0];
      await startSynthesisExportRun(fakeClient, {
        runId: "r", workspaceId: "w", projectId: null, userId: "u",
        format: "md", template: "report", userPrompt: "p",
        explicitSourceIds: [], noteIds: [], autoSearch: false, byokKeyHandle: null,
      });
      const [, opts] = start.mock.calls[0];
      expect(opts.workflowExecutionTimeout).toBe(300000);
    } finally {
      if (original === undefined) delete process.env.SYNTHESIS_EXPORT_TIMEOUT_MS;
      else process.env.SYNTHESIS_EXPORT_TIMEOUT_MS = original;
    }
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
