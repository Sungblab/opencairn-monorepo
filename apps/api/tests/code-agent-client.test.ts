import { describe, it, expect, vi } from "vitest";
import {
  startCodeRun,
  signalCodeFeedback,
  cancelCodeRun,
  workflowIdFor,
} from "../src/lib/code-agent-client";

describe("code-agent-client", () => {
  it("derives a stable workflow id from runId", () => {
    expect(workflowIdFor("abc-123")).toBe("code-agent-abc-123");
  });

  it("start passes 1h execution timeout and shared task queue", async () => {
    const start = vi.fn().mockResolvedValue({ workflowId: "code-agent-r1" });
    const fakeClient = {
      workflow: { start },
    } as unknown as import("@temporalio/client").Client;
    await startCodeRun(fakeClient, {
      runId: "r1",
      noteId: "n1",
      workspaceId: "w1",
      userId: "u1",
      prompt: "p",
      language: "python",
      byokKeyHandle: null,
    });
    expect(start).toHaveBeenCalledTimes(1);
    const [workflowType, options] = start.mock.calls[0];
    expect(workflowType).toBe("CodeAgentWorkflow");
    expect(options.workflowExecutionTimeout).toBe(60 * 60 * 1000);
    expect(options.taskQueue).toBe(process.env.TEMPORAL_TASK_QUEUE ?? "ingest");
    expect(options.workflowId).toBe("code-agent-r1");
    expect(options.args[0]).toMatchObject({ runId: "r1", language: "python" });
  });

  it("signalCodeFeedback forwards payload to client_feedback signal", async () => {
    const signal = vi.fn().mockResolvedValue(undefined);
    const fakeClient = {
      workflow: { getHandle: () => ({ signal }) },
    } as unknown as import("@temporalio/client").Client;
    await signalCodeFeedback(fakeClient, "r1", { kind: "error", error: "boom" });
    expect(signal).toHaveBeenCalledWith("client_feedback", {
      kind: "error",
      error: "boom",
    });
  });

  it("cancelCodeRun signals cancel on the workflow handle", async () => {
    const signal = vi.fn().mockResolvedValue(undefined);
    const fakeClient = {
      workflow: { getHandle: () => ({ signal }) },
    } as unknown as import("@temporalio/client").Client;
    await cancelCodeRun(fakeClient, "r1");
    expect(signal).toHaveBeenCalledWith("cancel");
  });
});
