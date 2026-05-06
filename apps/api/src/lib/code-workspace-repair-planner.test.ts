import { describe, expect, it } from "vitest";
import type { AgentAction, CodeWorkspaceCommandRunResult } from "@opencairn/shared";
import {
  createTemporalCodeRepairPlanner,
  workflowIdForCodeWorkspaceRepairAction,
} from "./code-workspace-repair-planner";
import type {
  CodeWorkspaceRecord,
  CodeWorkspaceSnapshotRecord,
} from "./code-project-workspaces";

describe("code workspace repair planner", () => {
  it("starts the worker workflow with the failed run, logs, and resolved snapshot manifest", async () => {
    const calls: unknown[] = [];
    const planner = createTemporalCodeRepairPlanner({
      startWorkflow: async (payload) => {
        calls.push(payload);
        return { workflowId: "code-workspace-repair-test" };
      },
    });

    const result = await planner.plan({
      requestId: "00000000-0000-4000-8000-000000000099",
      repairAction: repairAction(),
      failedRunAction: action(),
      runResult: runResult(),
      workspace: workspace(),
      snapshot: snapshot(),
    });

    expect(calls).toEqual([
      {
        repairActionId: "00000000-0000-4000-8000-000000000030",
        requestId: "00000000-0000-4000-8000-000000000099",
        failedRunActionId: "00000000-0000-4000-8000-000000000010",
        workspaceId: "00000000-0000-4000-8000-000000000001",
        projectId: "00000000-0000-4000-8000-000000000002",
        actorUserId: "user-1",
        codeWorkspaceId: "00000000-0000-4000-8000-000000000020",
        snapshotId: "00000000-0000-4000-8000-000000000021",
        command: "test",
        exitCode: 1,
        logs: [{ stream: "stderr", text: "tests failed" }],
        manifest: {
          entries: [
            {
              path: "src/App.tsx",
              kind: "file",
              bytes: 19,
              contentHash: "sha256:old",
              inlineContent: "export const broken;",
            },
          ],
        },
      },
    ]);
    expect(result).toMatchObject({
      kind: "started",
      workflowId: "code-workspace-repair-test",
    });
  });

  it("uses a stable workflow id per failed run and repair request", () => {
    expect(
      workflowIdForCodeWorkspaceRepairAction(
        "00000000-0000-4000-8000-000000000010",
        "00000000-0000-4000-8000-000000000099",
      ),
    ).toBe(
      "code-workspace-repair-00000000-0000-4000-8000-000000000010-00000000-0000-4000-8000-000000000099",
    );
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
    status: "failed",
    risk: "write",
    input: {},
    preview: null,
    result: null,
    errorCode: "code_project_run_failed",
    createdAt: "2026-05-05T00:00:00.000Z",
    updatedAt: "2026-05-05T00:00:00.000Z",
  };
}

function repairAction(): AgentAction {
  return {
    ...action(),
    id: "00000000-0000-4000-8000-000000000030",
    requestId: "00000000-0000-4000-8000-000000000099",
    kind: "code_project.patch",
    status: "running",
    errorCode: null,
  };
}

function workspace(): CodeWorkspaceRecord {
  return {
    id: "00000000-0000-4000-8000-000000000020",
    requestId: "00000000-0000-4000-8000-000000000012",
    workspaceId: "00000000-0000-4000-8000-000000000001",
    projectId: "00000000-0000-4000-8000-000000000002",
    createdBy: "user-1",
    name: "Repairable app",
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
          path: "src/App.tsx",
          kind: "file",
          bytes: 19,
          contentHash: "sha256:old",
          inlineContent: "export const broken;",
        },
      ],
    },
  };
}

function runResult(): CodeWorkspaceCommandRunResult {
  return {
    ok: false,
    codeWorkspaceId: "00000000-0000-4000-8000-000000000020",
    snapshotId: "00000000-0000-4000-8000-000000000021",
    command: "test",
    exitCode: 1,
    durationMs: 25,
    logs: [{ stream: "stderr", text: "tests failed" }],
  };
}
