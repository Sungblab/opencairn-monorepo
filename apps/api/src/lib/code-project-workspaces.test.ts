import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AgentActionError } from "./agent-actions";
import {
  createCodeWorkspaceDraft,
  createMemoryCodeWorkspaceRepository,
  prepareCodeWorkspacePatch,
} from "./code-project-workspaces";

const scope = {
  workspaceId: "00000000-0000-4000-8000-000000000001",
  projectId: "00000000-0000-4000-8000-000000000002",
  actorUserId: "user-1",
};

describe("code project workspace service", () => {
  it("injects trusted scope and creates the initial immutable snapshot idempotently", async () => {
    const repo = createMemoryCodeWorkspaceRepository();
    const requestId = randomUUID();

    const first = await createCodeWorkspaceDraft(repo, scope, {
      requestId,
      name: "Demo app",
      language: "typescript",
      framework: "react",
      manifest: {
        entries: [
          { path: "src", kind: "directory" },
          { path: "src/App.tsx", kind: "file", bytes: 10, contentHash: "sha256:app" },
        ],
      },
    });
    const second = await createCodeWorkspaceDraft(repo, scope, {
      requestId,
      name: "Ignored duplicate",
      manifest: { entries: [] },
    });

    expect(first.idempotent).toBe(false);
    expect(second.idempotent).toBe(true);
    expect(second.workspace.id).toBe(first.workspace.id);
    expect(first.workspace.workspaceId).toBe(scope.workspaceId);
    expect(first.workspace.projectId).toBe(scope.projectId);
    expect(first.workspace.createdBy).toBe(scope.actorUserId);
    expect(first.snapshot.manifest.entries.map((entry) => entry.path)).toEqual([
      "src",
      "src/App.tsx",
    ]);
    const canonical = "directory:src:|file:src/App.tsx:sha256:app";
    expect(first.snapshot.treeHash).toBe(
      `sha256:${createHash("sha256").update(canonical, "utf8").digest("base64url")}`,
    );
  });

  it("rejects caller scope fields before writing storage", async () => {
    const repo = createMemoryCodeWorkspaceRepository();

    await expect(
      createCodeWorkspaceDraft(repo, scope, {
        workspaceId: "00000000-0000-4000-8000-000000000099",
        name: "Bad scope",
        manifest: { entries: [] },
      } as never),
    ).rejects.toMatchObject(new AgentActionError("scope_fields_are_server_injected", 400));

    expect(repo.rows.workspaces.size).toBe(0);
  });

  it("rejects stale patch bases and returns idempotent existing patch requests", async () => {
    const repo = createMemoryCodeWorkspaceRepository();
    const created = await createCodeWorkspaceDraft(repo, scope, {
      requestId: randomUUID(),
      name: "Demo app",
      manifest: {
        entries: [{ path: "src/App.tsx", kind: "file", bytes: 10, contentHash: "sha256:app" }],
      },
    });
    const requestId = randomUUID();

    const patch = await prepareCodeWorkspacePatch(repo, scope, {
      requestId,
      codeWorkspaceId: created.workspace.id,
      baseSnapshotId: created.snapshot.id,
      operations: [
        {
          op: "update",
          path: "src/App.tsx",
          beforeHash: "sha256:app",
          afterHash: "sha256:new",
          inlineContent: "updated",
        },
      ],
      preview: { filesChanged: 1, additions: 1, deletions: 1, summary: "Update app" },
      risk: "write",
    });
    const duplicate = await prepareCodeWorkspacePatch(repo, scope, {
      requestId,
      codeWorkspaceId: created.workspace.id,
      baseSnapshotId: created.snapshot.id,
      operations: [
        {
          op: "delete",
          path: "src/App.tsx",
          beforeHash: "sha256:app",
        },
      ],
      preview: { filesChanged: 1, additions: 0, deletions: 1, summary: "Ignored" },
      risk: "destructive",
    });

    expect(patch.idempotent).toBe(false);
    expect(duplicate.idempotent).toBe(true);
    expect(duplicate.patch.id).toBe(patch.patch.id);

    await expect(
      prepareCodeWorkspacePatch(repo, scope, {
        requestId: randomUUID(),
        codeWorkspaceId: created.workspace.id,
        baseSnapshotId: randomUUID(),
        operations: [
          {
            op: "update",
            path: "src/App.tsx",
            beforeHash: "sha256:app",
            afterHash: "sha256:newer",
          },
        ],
        preview: { filesChanged: 1, additions: 1, deletions: 1, summary: "Stale" },
        risk: "write",
      }),
    ).rejects.toMatchObject(new AgentActionError("code_workspace_stale_base", 409));
  });
});
