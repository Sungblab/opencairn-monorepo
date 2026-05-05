import { describe, expect, it } from "vitest";
import type { AgentAction, CodeWorkspaceInstallRequest } from "@opencairn/shared";
import {
  createTemporalCodeInstallRunner,
  workflowIdForCodeWorkspaceInstallAction,
} from "./code-workspace-install-runner";
import type {
  CodeWorkspaceRecord,
  CodeWorkspaceSnapshotRecord,
} from "./code-project-workspaces";

describe("code workspace install runner", () => {
  it("starts the worker workflow with the resolved snapshot manifest", async () => {
    const calls: unknown[] = [];
    const runner = createTemporalCodeInstallRunner({
      startWorkflow: async (payload) => {
        calls.push(payload);
        return {
          ok: true,
          codeWorkspaceId: payload.codeWorkspaceId,
          snapshotId: payload.snapshotId,
          packageManager: payload.packageManager,
          installed: payload.packages,
          exitCode: 0,
          durationMs: 12,
          logs: [{ stream: "stdout", text: "install passed" }],
        };
      },
    });

    const result = await runner.install({
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
        packageManager: "pnpm",
        packages: [{ name: "zod", version: "3.25.0", dev: false }],
        timeoutMs: 120_000,
        manifest: {
          entries: [
            {
              path: "package.json",
              kind: "file",
              bytes: 16,
              contentHash: "sha256:pkg",
              inlineContent: "{\"dependencies\":{}}",
            },
          ],
        },
      },
    ]);
    expect(result).toMatchObject({
      ok: true,
      packageManager: "pnpm",
      installed: [{ name: "zod", version: "3.25.0", dev: false }],
      exitCode: 0,
      logs: [{ stream: "stdout", text: "install passed" }],
    });
  });

  it("uses a stable workflow id per action", () => {
    expect(
      workflowIdForCodeWorkspaceInstallAction("00000000-0000-4000-8000-000000000010"),
    ).toBe("code-workspace-install-00000000-0000-4000-8000-000000000010");
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
    kind: "code_project.install",
    status: "running",
    risk: "external",
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
    name: "Installable app",
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
          inlineContent: "{\"dependencies\":{}}",
        },
      ],
    },
  };
}

function request(): CodeWorkspaceInstallRequest {
  return {
    requestId: "00000000-0000-4000-8000-000000000011",
    codeWorkspaceId: "00000000-0000-4000-8000-000000000020",
    snapshotId: "00000000-0000-4000-8000-000000000021",
    packageManager: "pnpm",
    packages: [{ name: "zod", version: "3.25.0", dev: false }],
    network: "required",
    timeoutMs: 120_000,
  } as CodeWorkspaceInstallRequest;
}
