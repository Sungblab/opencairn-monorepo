import { describe, expect, it } from "vitest";
import type { AgentAction, CodeWorkspaceCommandRunRequest } from "@opencairn/shared";
import {
  cancelCodeWorkspaceCommandWorkflow,
  createTemporalCodeCommandRunner,
  workflowIdForCodeWorkspaceCommandAction,
} from "./code-workspace-command-runner";
import type {
  CodeWorkspaceRecord,
  CodeWorkspaceSnapshotRecord,
} from "./code-project-workspaces";

describe("code workspace command runner", () => {
  it("starts the worker workflow with the resolved snapshot manifest", async () => {
    const calls: unknown[] = [];
    const runner = createTemporalCodeCommandRunner({
      startWorkflow: async (payload) => {
        calls.push(payload);
        return { workflowId: "code-workspace-command-test" };
      },
    });

    const result = await runner.run({
      action: action(),
      workspace: workspace(),
      snapshot: snapshot(),
      request: request(),
    });

    expect(calls).toEqual([
      {
        actionId: "00000000-0000-4000-8000-000000000010",
        requestId: "00000000-0000-4000-8000-000000000011",
        workspaceId: "00000000-0000-4000-8000-000000000001",
        projectId: "00000000-0000-4000-8000-000000000002",
        actorUserId: "user-1",
        codeWorkspaceId: "00000000-0000-4000-8000-000000000020",
        snapshotId: "00000000-0000-4000-8000-000000000021",
        command: "test",
        timeoutMs: 30_000,
        manifest: {
          entries: [
            {
              path: "package.json",
              kind: "file",
              bytes: 16,
              contentHash: "sha256:pkg",
              inlineContent: "{\"scripts\":{}}",
            },
          ],
        },
      },
    ]);
    expect(result).toMatchObject({
      kind: "started",
      workflowId: "code-workspace-command-test",
    });
  });

  it("uses a stable workflow id per action", () => {
    expect(
      workflowIdForCodeWorkspaceCommandAction("00000000-0000-4000-8000-000000000010"),
    ).toBe("code-workspace-command-00000000-0000-4000-8000-000000000010");
  });

  it("cancels the stable worker workflow for an action", async () => {
    const calls: string[] = [];
    await cancelCodeWorkspaceCommandWorkflow(
      "00000000-0000-4000-8000-000000000010",
      {
        workflow: {
          getHandle(workflowId: string) {
            calls.push(workflowId);
            return {
              async cancel() {
                calls.push("cancel");
              },
            };
          },
        },
      } as never,
    );

    expect(calls).toEqual([
      "code-workspace-command-00000000-0000-4000-8000-000000000010",
      "cancel",
    ]);
  });
});

function action(): AgentAction {
  return {
    id: "00000000-0000-4000-8000-000000000010",
    requestId: "00000000-0000-4000-8000-000000000011",
    workspaceId: "00000000-0000-4000-8000-000000000001",
    projectId: "00000000-0000-4000-8000-000000000002",
    actorUserId: "user-1",
    sourceRunId: null,
    kind: "code_project.run",
    status: "running",
    risk: "write",
    input: {},
    preview: null,
    result: null,
    errorCode: null,
    createdAt: "2026-05-05T00:00:00.000Z",
    updatedAt: "2026-05-05T00:00:00.000Z",
  };
}

function workspace(): CodeWorkspaceRecord {
  return {
    id: "00000000-0000-4000-8000-000000000020",
    requestId: "00000000-0000-4000-8000-000000000012",
    workspaceId: "00000000-0000-4000-8000-000000000001",
    projectId: "00000000-0000-4000-8000-000000000002",
    createdBy: "user-1",
    name: "Runnable app",
    description: null,
    language: null,
    framework: null,
    currentSnapshotId: "00000000-0000-4000-8000-000000000021",
    sourceRunId: null,
    sourceActionId: null,
  };
}

function snapshot(): CodeWorkspaceSnapshotRecord {
  return {
    id: "00000000-0000-4000-8000-000000000021",
    codeWorkspaceId: "00000000-0000-4000-8000-000000000020",
    parentSnapshotId: null,
    treeHash: "sha256:tree",
    manifest: {
      entries: [
        {
          path: "package.json",
          kind: "file",
          bytes: 16,
          contentHash: "sha256:pkg",
          inlineContent: "{\"scripts\":{}}",
        },
      ],
    },
  };
}

function request(): CodeWorkspaceCommandRunRequest {
  return {
    requestId: "00000000-0000-4000-8000-000000000011",
    codeWorkspaceId: "00000000-0000-4000-8000-000000000020",
    snapshotId: "00000000-0000-4000-8000-000000000021",
    command: "test",
    timeoutMs: 30_000,
  };
}
