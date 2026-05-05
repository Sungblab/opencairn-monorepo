import { describe, expect, it, vi } from "vitest";
import {
  AgentActionError,
  applyAgentAction,
  cancelCodeProjectRunAction,
  canTransition,
  cleanupExpiredCodeProjectPreviews,
  createAgentAction,
  executeAgentAction,
  applyNoteUpdateAction,
  createQueuedWorkflowAgentAction,
  markWorkflowAgentActionFailed,
  readCodeProjectPreviewAsset,
  transitionAgentActionStatus,
  type AgentActionRepository,
  type NoteActionExecutor,
  type NoteUpdateApplier,
  type NoteUpdatePreviewer,
} from "./agent-actions";
import type { AgentAction } from "@opencairn/shared";
import { createMemoryCodeWorkspaceRepository } from "./code-project-workspaces";

const userId = "user-1";
const workspaceId = "00000000-0000-4000-8000-000000000001";
const projectId = "00000000-0000-4000-8000-000000000002";
const actionId = "00000000-0000-4000-8000-000000000003";
const requestId = "00000000-0000-4000-8000-000000000004";

describe("agent action service", () => {
  it("creates a completed low-risk placeholder action with server-injected scope", async () => {
    const repo = createMemoryRepo();

    const { action, idempotent } = await createAgentAction(
      projectId,
      userId,
      {
        requestId,
        kind: "workflow.placeholder",
        risk: "low",
        input: { label: "smoke" },
      },
      { repo, canWriteProject: async () => true },
    );

    expect(idempotent).toBe(false);
    expect(action).toMatchObject({
      requestId,
      workspaceId,
      projectId,
      actorUserId: userId,
      kind: "workflow.placeholder",
      status: "completed",
      risk: "low",
      input: { label: "smoke" },
      result: { ok: true, placeholder: true, input: { label: "smoke" } },
    });
  });

  it("returns an existing row for the same requestId", async () => {
    const repo = createMemoryRepo();

    const first = await createAgentAction(
      projectId,
      userId,
      { requestId, kind: "workflow.placeholder", risk: "low" },
      { repo, canWriteProject: async () => true },
    );
    const second = await createAgentAction(
      projectId,
      userId,
      { requestId, kind: "workflow.placeholder", risk: "low", input: { ignored: true } },
      { repo, canWriteProject: async () => true },
    );

    expect(second.idempotent).toBe(true);
    expect(second.action).toEqual(first.action);
  });

  it("rejects unauthorized project actions before insertion", async () => {
    await expect(
      createAgentAction(
        projectId,
        userId,
        { requestId, kind: "workflow.placeholder", risk: "low" },
        { repo: createMemoryRepo(), canWriteProject: async () => false },
      ),
    ).rejects.toMatchObject(new AgentActionError("forbidden", 403));
  });

  it("enforces status transitions", async () => {
    expect(canTransition("draft", "queued")).toBe(true);
    expect(canTransition("completed", "running")).toBe(false);

    const repo = createMemoryRepo();
    const { action } = await createAgentAction(
      projectId,
      userId,
      { requestId, kind: "file.create", risk: "write" },
      { repo, canWriteProject: async () => true },
    );
    expect(action.status).toBe("approval_required");

    const queued = await transitionAgentActionStatus(
      action.id,
      userId,
      { status: "queued", preview: { summary: "ready" } },
      { repo, canWriteProject: async () => true },
    );
    expect(queued.status).toBe("queued");
    expect(queued.preview).toEqual({ summary: "ready" });

    await expect(
      transitionAgentActionStatus(
        action.id,
        userId,
        { status: "reverted" },
        { repo, canWriteProject: async () => true },
      ),
    ).rejects.toMatchObject(new AgentActionError("invalid_status_transition", 409));
  });

  it("executes a note.create action once and stores the completed result", async () => {
    const repo = createMemoryRepo();
    const noteExecutor = createMemoryNoteExecutor();

    const first = await createAgentAction(
      projectId,
      userId,
      {
        requestId,
        kind: "note.create",
        risk: "write",
        input: { title: "Agent brief", folderId: null },
      },
      { repo, canWriteProject: async () => true, noteExecutor },
    );
    const second = await createAgentAction(
      projectId,
      userId,
      {
        requestId,
        kind: "note.create",
        risk: "write",
        input: { title: "Agent brief", folderId: null },
      },
      { repo, canWriteProject: async () => true, noteExecutor },
    );

    expect(first.idempotent).toBe(false);
    expect(second.idempotent).toBe(true);
    expect(noteExecutor.createdNoteIds).toEqual(["00000000-0000-4000-8000-000000000090"]);
    expect(second.action).toMatchObject({
      status: "completed",
      result: {
        ok: true,
        note: {
          id: "00000000-0000-4000-8000-000000000090",
          projectId,
          folderId: null,
          title: "Agent brief",
        },
      },
      errorCode: null,
    });
  });

  it("marks note action execution failures on the ledger", async () => {
    const repo = createMemoryRepo();
    const noteExecutor = createMemoryNoteExecutor({
      failWith: new AgentActionError("note_not_found", 404),
    });

    const { action } = await createAgentAction(
      projectId,
      userId,
      {
        requestId,
        kind: "note.rename",
        risk: "write",
        input: {
          noteId: "00000000-0000-4000-8000-000000000021",
          title: "Renamed brief",
        },
      },
      { repo, canWriteProject: async () => true, noteExecutor },
    );

    expect(action.status).toBe("failed");
    expect(action.errorCode).toBe("note_not_found");
    expect(action.result).toEqual({ ok: false, errorCode: "note_not_found" });
  });

  it("executes Phase 2A note mutations through typed action inputs", async () => {
    const repo = createMemoryRepo();
    const noteExecutor = createMemoryNoteExecutor();

    const rename = await executeAgentAction(
      projectId,
      userId,
      {
        requestId,
        kind: "note.rename",
        risk: "write",
        input: {
          noteId: "00000000-0000-4000-8000-000000000021",
          title: "Renamed brief",
        },
      },
      { repo, canWriteProject: async () => true, noteExecutor },
    );
    expect(rename.action.status).toBe("completed");
    expect(noteExecutor.calls.map((call) => call.kind)).toEqual(["note.rename"]);

    await executeAgentAction(
      projectId,
      userId,
      {
        requestId: "00000000-0000-4000-8000-000000000005",
        kind: "note.move",
        risk: "write",
        input: {
          noteId: "00000000-0000-4000-8000-000000000021",
          folderId: null,
        },
      },
      { repo, canWriteProject: async () => true, noteExecutor },
    );
    await executeAgentAction(
      projectId,
      userId,
      {
        requestId: "00000000-0000-4000-8000-000000000006",
        kind: "note.delete",
        risk: "destructive",
        input: { noteId: "00000000-0000-4000-8000-000000000021" },
      },
      { repo, canWriteProject: async () => true, noteExecutor },
    );
    await executeAgentAction(
      projectId,
      userId,
      {
        requestId: "00000000-0000-4000-8000-000000000007",
        kind: "note.restore",
        risk: "write",
        input: { noteId: "00000000-0000-4000-8000-000000000021" },
      },
      { repo, canWriteProject: async () => true, noteExecutor },
    );

    expect(noteExecutor.calls.map((call) => call.kind)).toEqual([
      "note.rename",
      "note.move",
      "note.delete",
      "note.restore",
    ]);
  });

  it("creates note.update as a preview-only draft without applying content", async () => {
    const repo = createMemoryRepo();
    const noteExecutor = createMemoryNoteExecutor();
    const noteUpdatePreviewer = createMemoryNoteUpdatePreviewer();

    const { action, idempotent } = await createAgentAction(
      projectId,
      userId,
      {
        requestId,
        kind: "note.update",
        risk: "write",
        input: {
          noteId: "00000000-0000-4000-8000-000000000021",
          draft: {
            format: "plate_value_v1",
            content: [{ type: "p", children: [{ text: "updated draft" }] }],
          },
          reason: "tighten intro",
        },
      },
      {
        repo,
        canWriteProject: async () => true,
        noteExecutor,
        noteUpdatePreviewer,
      },
    );

    expect(idempotent).toBe(false);
    expect(noteExecutor.calls).toEqual([]);
    expect(noteUpdatePreviewer.calls).toEqual([
      { noteId: "00000000-0000-4000-8000-000000000021" },
    ]);
    expect(action).toMatchObject({
      status: "draft",
      kind: "note.update",
      preview: {
        noteId: "00000000-0000-4000-8000-000000000021",
        source: "yjs",
        current: { contentText: "old draft" },
        draft: { contentText: "updated draft" },
      },
      result: null,
      errorCode: null,
    });
  });

  it("applies a draft note.update action through a Yjs applier and completes the ledger row", async () => {
    const repo = createMemoryRepo();
    const noteUpdatePreviewer = createMemoryNoteUpdatePreviewer();
    const noteUpdateApplier = createMemoryNoteUpdateApplier();
    const { action } = await createAgentAction(
      projectId,
      userId,
      {
        requestId,
        kind: "note.update",
        risk: "write",
        input: {
          noteId: "00000000-0000-4000-8000-000000000021",
          draft: {
            format: "plate_value_v1",
            content: [{ type: "p", id: "block-1", children: [{ text: "updated draft" }] }],
          },
          reason: "tighten intro",
        },
      },
      {
        repo,
        canWriteProject: async () => true,
        noteUpdatePreviewer,
      },
    );

    const applied = await applyNoteUpdateAction(
      action.id,
      userId,
      { yjsStateVectorBase64: "AQID" },
      {
        repo,
        canWriteProject: async () => true,
        noteUpdateApplier,
      },
    );

    expect(noteUpdateApplier.calls).toEqual([
      {
        actionId: action.id,
        noteId: "00000000-0000-4000-8000-000000000021",
        expectedVector: "AQID",
      },
    ]);
    expect(applied).toMatchObject({
      status: "completed",
      result: {
        ok: true,
        noteId: "00000000-0000-4000-8000-000000000021",
        applied: {
          source: "yjs",
          yjsStateVectorBase64: "BAUG",
          contentText: "updated draft",
        },
        versionCapture: {
          before: { created: true, version: 4 },
          after: { created: true, version: 5 },
        },
      },
      errorCode: null,
    });
  });

  it("materializes an approved static code_project.preview action", async () => {
    const repo = createMemoryRepo();
    const codeWorkspaceRepo = createMemoryCodeWorkspaceRepository();
    const { workspace, snapshot } = await codeWorkspaceRepo.createWorkspaceDraft({
      scope: { workspaceId, projectId, actorUserId: userId },
      requestId: "00000000-0000-4000-8000-000000000030",
      snapshotId: "00000000-0000-4000-8000-000000000031",
      treeHash: "sha256:preview",
      request: {
        name: "Preview app",
        manifest: {
          entries: [
            {
              path: "index.html",
              kind: "file",
              bytes: 16,
              contentHash: "sha256:index",
              inlineContent: "<h1>Preview</h1>",
            },
          ],
        },
      },
    });
    const { action } = await createAgentAction(
      projectId,
      userId,
      {
        requestId,
        kind: "code_project.preview",
        risk: "external",
        input: {
          codeWorkspaceId: workspace.id,
          snapshotId: snapshot.id,
          mode: "static",
          entryPath: "index.html",
        },
      },
      { repo, codeWorkspaceRepo, canWriteProject: async () => true },
    );

    const applied = await applyAgentAction(action.id, userId, {}, {
      repo,
      codeWorkspaceRepo,
      canWriteProject: async () => true,
      now: () => new Date("2026-05-05T00:00:00.000Z"),
      codePreviewTtlMs: 60_000,
    });

    expect(applied).toMatchObject({
      status: "completed",
      result: {
        ok: true,
        kind: "code_project.preview",
        mode: "static",
        codeWorkspaceId: workspace.id,
        snapshotId: snapshot.id,
        entryPath: "index.html",
        previewUrl: `/api/agent-actions/${action.id}/preview/index.html`,
        expiresAt: "2026-05-05T00:01:00.000Z",
      },
    });
  });

  it("reads object-backed static code_project.preview assets through the object reader", async () => {
    const repo = createMemoryRepo();
    const codeWorkspaceRepo = createMemoryCodeWorkspaceRepository();
    const { workspace, snapshot } = await codeWorkspaceRepo.createWorkspaceDraft({
      scope: { workspaceId, projectId, actorUserId: userId },
      requestId: "00000000-0000-4000-8000-000000000032",
      snapshotId: "00000000-0000-4000-8000-000000000033",
      treeHash: "sha256:preview-object",
      request: {
        name: "Preview app",
        manifest: {
          entries: [
            {
              path: "index.html",
              kind: "file",
              bytes: 16,
              contentHash: "sha256:index",
              inlineContent: "<link rel=\"stylesheet\" href=\"style.css\">",
            },
            {
              path: "style.css",
              kind: "file",
              bytes: 19,
              mimeType: "text/css",
              contentHash: "sha256:css",
              objectKey: "code-workspaces/demo/style.css",
            },
          ],
        },
      },
    });
    const { action } = await createAgentAction(
      projectId,
      userId,
      {
        requestId,
        kind: "code_project.preview",
        risk: "external",
        input: {
          codeWorkspaceId: workspace.id,
          snapshotId: snapshot.id,
          mode: "static",
          entryPath: "index.html",
        },
      },
      { repo, codeWorkspaceRepo, canWriteProject: async () => true },
    );
    await applyAgentAction(action.id, userId, {}, {
      repo,
      codeWorkspaceRepo,
      canWriteProject: async () => true,
      now: () => new Date("2026-05-05T00:00:00.000Z"),
    });
    const calls: string[] = [];

    const asset = await readCodeProjectPreviewAsset(
      action.id,
      userId,
      "style.css",
      {
        repo,
        codeWorkspaceRepo,
        canWriteProject: async () => true,
        now: () => new Date("2026-05-05T00:00:30.000Z"),
        codePreviewObjectReader: {
          async read(objectKey) {
            calls.push(objectKey);
            return {
              body: "body{color:red}",
              contentType: "text/css; charset=utf-8",
              contentLength: 15,
            };
          },
        },
      },
    );

    expect(calls).toEqual(["code-workspaces/demo/style.css"]);
    expect(asset).toMatchObject({
      body: "body{color:red}",
      contentType: "text/css; charset=utf-8",
      contentLength: 15,
    });
  });

  it("materializes an object-backed static code_project.preview entry", async () => {
    const repo = createMemoryRepo();
    const codeWorkspaceRepo = createMemoryCodeWorkspaceRepository();
    const { workspace, snapshot } = await codeWorkspaceRepo.createWorkspaceDraft({
      scope: { workspaceId, projectId, actorUserId: userId },
      requestId: "00000000-0000-4000-8000-000000000034",
      snapshotId: "00000000-0000-4000-8000-000000000035",
      treeHash: "sha256:preview-object-entry",
      request: {
        name: "Preview app",
        manifest: {
          entries: [
            {
              path: "index.html",
              kind: "file",
              bytes: 16,
              mimeType: "text/html",
              contentHash: "sha256:index",
              objectKey: "code-workspaces/demo/index.html",
            },
          ],
        },
      },
    });
    const { action } = await createAgentAction(
      projectId,
      userId,
      {
        requestId,
        kind: "code_project.preview",
        risk: "external",
        input: {
          codeWorkspaceId: workspace.id,
          snapshotId: snapshot.id,
          mode: "static",
          entryPath: "index.html",
        },
      },
      { repo, codeWorkspaceRepo, canWriteProject: async () => true },
    );

    const applied = await applyAgentAction(action.id, userId, {}, {
      repo,
      codeWorkspaceRepo,
      canWriteProject: async () => true,
      now: () => new Date("2026-05-05T00:00:00.000Z"),
    });
    const calls: string[] = [];
    const asset = await readCodeProjectPreviewAsset(
      action.id,
      userId,
      undefined,
      {
        repo,
        codeWorkspaceRepo,
        canWriteProject: async () => true,
        now: () => new Date("2026-05-05T00:00:30.000Z"),
        codePreviewObjectReader: {
          async read(objectKey) {
            calls.push(objectKey);
            return {
              body: "<h1>Preview</h1>",
              contentType: "text/html; charset=utf-8",
              contentLength: 16,
            };
          },
        },
      },
    );

    expect(applied).toMatchObject({
      status: "completed",
      result: {
        ok: true,
        kind: "code_project.preview",
        entryPath: "index.html",
        previewUrl: `/api/agent-actions/${action.id}/preview/index.html`,
      },
    });
    expect(calls).toEqual(["code-workspaces/demo/index.html"]);
    expect(asset).toMatchObject({
      body: "<h1>Preview</h1>",
      contentType: "text/html; charset=utf-8",
      contentLength: 16,
    });
  });

  it("expires completed static code_project.preview actions during cleanup", async () => {
    const expiredPreview = makeAction({
      kind: "code_project.preview",
      status: "completed",
      risk: "external",
      result: {
        ok: true,
        kind: "code_project.preview",
        mode: "static",
        codeWorkspaceId: "00000000-0000-4000-8000-000000000030",
        snapshotId: "00000000-0000-4000-8000-000000000031",
        entryPath: "index.html",
        previewUrl: `/api/agent-actions/${actionId}/preview/index.html`,
        assetsBaseUrl: `/api/agent-actions/${actionId}/preview/`,
        expiresAt: "2026-05-05T00:01:00.000Z",
      },
    });
    const freshPreview = makeAction({
      id: "00000000-0000-4000-8000-000000000040",
      requestId: "00000000-0000-4000-8000-000000000041",
      kind: "code_project.preview",
      status: "completed",
      risk: "external",
      result: {
        ok: true,
        kind: "code_project.preview",
        mode: "static",
        codeWorkspaceId: "00000000-0000-4000-8000-000000000030",
        snapshotId: "00000000-0000-4000-8000-000000000031",
        entryPath: "index.html",
        previewUrl: "/api/agent-actions/fresh/preview/index.html",
        assetsBaseUrl: "/api/agent-actions/fresh/preview/",
        expiresAt: "2026-05-05T00:10:00.000Z",
      },
    });
    const repo = createMemoryRepo([expiredPreview, freshPreview]);

    const cleanup = await cleanupExpiredCodeProjectPreviews({
      repo,
      now: () => new Date("2026-05-05T00:02:00.000Z"),
    });

    expect(cleanup).toMatchObject({
      expiredCount: 1,
      actionIds: [expiredPreview.id],
    });
    await expect(repo.findById(expiredPreview.id)).resolves.toMatchObject({
      status: "expired",
      errorCode: "code_project_preview_expired",
    });
    await expect(repo.findById(freshPreview.id)).resolves.toMatchObject({
      status: "completed",
      errorCode: null,
    });
  });

  it("rejects static preview reads after cleanup expires the action", async () => {
    const repo = createMemoryRepo([
      makeAction({
        kind: "code_project.preview",
        status: "expired",
        risk: "external",
        result: {
          ok: true,
          kind: "code_project.preview",
          mode: "static",
          codeWorkspaceId: "00000000-0000-4000-8000-000000000030",
          snapshotId: "00000000-0000-4000-8000-000000000031",
          entryPath: "index.html",
          previewUrl: `/api/agent-actions/${actionId}/preview/index.html`,
          assetsBaseUrl: `/api/agent-actions/${actionId}/preview/`,
          expiresAt: "2026-05-05T00:01:00.000Z",
        },
        errorCode: "code_project_preview_expired",
      }),
    ]);

    await expect(
      readCodeProjectPreviewAsset(actionId, userId, "index.html", {
        repo,
        codeWorkspaceRepo: createMemoryCodeWorkspaceRepository(),
        canWriteProject: async () => true,
      }),
    ).rejects.toMatchObject(new AgentActionError("code_project_preview_expired", 409));
  });

  it("marks note.update apply as failed and returns a stable 409 error on stale preview", async () => {
    const repo = createMemoryRepo();
    const { action } = await createAgentAction(
      projectId,
      userId,
      {
        requestId,
        kind: "note.update",
        risk: "write",
        input: {
          noteId: "00000000-0000-4000-8000-000000000021",
          draft: {
            format: "plate_value_v1",
            content: [{ type: "p", children: [{ text: "updated draft" }] }],
          },
        },
      },
      {
        repo,
        canWriteProject: async () => true,
        noteUpdatePreviewer: createMemoryNoteUpdatePreviewer(),
      },
    );

    await expect(
      applyNoteUpdateAction(
        action.id,
        userId,
        { yjsStateVectorBase64: "stale" },
        {
          repo,
          canWriteProject: async () => true,
          noteUpdateApplier: createMemoryNoteUpdateApplier({
            failWith: new AgentActionError("note_update_stale_preview", 409),
          }),
        },
      ),
    ).rejects.toMatchObject(new AgentActionError("note_update_stale_preview", 409));

    const failed = await repo.findById(action.id);
    expect(failed).toMatchObject({
      status: "failed",
      errorCode: "note_update_stale_preview",
      result: { ok: false, errorCode: "note_update_stale_preview" },
    });
  });

  it("creates a queued import/export workflow action with server-owned scope", async () => {
    const repo = createMemoryRepo();

    const { action, idempotent } = await createQueuedWorkflowAgentAction(
      {
        workspaceId,
        projectId,
        actorUserId: userId,
        requestId,
        sourceRunId: "import-job-1",
        kind: "import.markdown_zip",
        risk: "write",
        input: { source: "markdown_zip" },
        result: {
          jobId: "import-job-1",
          workflowId: "import-workflow-1",
          workflowHint: "import",
        },
      },
      { repo, canWriteProject: async () => true },
    );

    expect(idempotent).toBe(false);
    expect(action).toMatchObject({
      requestId,
      workspaceId,
      projectId,
      actorUserId: userId,
      sourceRunId: "import-job-1",
      kind: "import.markdown_zip",
      status: "queued",
      risk: "write",
      input: { source: "markdown_zip" },
      result: {
        jobId: "import-job-1",
        workflowId: "import-workflow-1",
        workflowHint: "import",
      },
    });
  });

  it("marks workflow start failures as terminal failed ledger rows", async () => {
    const repo = createMemoryRepo();
    const { action } = await createQueuedWorkflowAgentAction(
      {
        workspaceId,
        projectId,
        actorUserId: userId,
        requestId,
        kind: "export.project",
        risk: "expensive",
      },
      { repo, canWriteProject: async () => true },
    );

    const failed = await markWorkflowAgentActionFailed(
      action.id,
      "synthesis_export_start_failed",
      {
        ok: false,
        runId: "run-1",
        errorCode: "synthesis_export_start_failed",
        retryable: true,
      },
      { repo },
    );

    expect(failed).toMatchObject({
      status: "failed",
      errorCode: "synthesis_export_start_failed",
      result: {
        ok: false,
        runId: "run-1",
        errorCode: "synthesis_export_start_failed",
        retryable: true,
      },
    });
  });

  it("rejects queued workflow actions without project write permission", async () => {
    await expect(
      createQueuedWorkflowAgentAction(
        {
          workspaceId,
          projectId,
          actorUserId: userId,
          requestId,
          kind: "export.project",
          risk: "expensive",
        },
        { repo: createMemoryRepo(), canWriteProject: async () => false },
      ),
    ).rejects.toMatchObject(new AgentActionError("forbidden", 403));
  });

  it("cancels a running code_project.run action through the command workflow canceller", async () => {
    const running = makeAction({
      kind: "code_project.run",
      status: "running",
      risk: "write",
      result: null,
    });
    const repo = createMemoryRepo([running]);
    const calls: string[] = [];

    const { action, idempotent } = await cancelCodeProjectRunAction(
      running.id,
      userId,
      {
        repo,
        canWriteProject: async () => true,
        codeCommandCanceller: {
          async cancel(input) {
            calls.push(input.action.id);
          },
        },
      },
    );

    expect(idempotent).toBe(false);
    expect(calls).toEqual([running.id]);
    expect(action).toMatchObject({
      status: "cancelled",
      errorCode: "cancelled",
      result: { ok: false, errorCode: "cancelled" },
    });
  });

  it("treats an already cancelled code_project.run action as idempotent", async () => {
    const cancelled = makeAction({
      kind: "code_project.run",
      status: "cancelled",
      risk: "write",
      errorCode: "cancelled",
      result: { ok: false, errorCode: "cancelled" },
    });

    await expect(
      cancelCodeProjectRunAction(cancelled.id, userId, {
        repo: createMemoryRepo([cancelled]),
        canWriteProject: async () => true,
        codeCommandCanceller: {
          async cancel() {
            throw new Error("should not cancel twice");
          },
        },
      }),
    ).resolves.toMatchObject({ action: cancelled, idempotent: true });
  });

  it("marks code_project.run cancelled even when workflow cancellation is best-effort", async () => {
    const running = makeAction({
      kind: "code_project.run",
      status: "running",
      risk: "write",
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    try {
      await expect(
        cancelCodeProjectRunAction(running.id, userId, {
          repo: createMemoryRepo([running]),
          canWriteProject: async () => true,
          codeCommandCanceller: {
            async cancel() {
              throw new Error("temporal unavailable");
            },
          },
        }),
      ).resolves.toMatchObject({
        action: {
          status: "cancelled",
          errorCode: "cancelled",
        },
        idempotent: false,
      });
    } finally {
      warn.mockRestore();
    }
  });
});

function createMemoryRepo(seed: AgentAction[] = []): AgentActionRepository {
  const rows = new Map<string, AgentAction>(seed.map((row) => [row.id, row]));
  return {
    async findProjectScope(id) {
      return id === projectId ? { workspaceId } : null;
    },
    async findByRequestId(pid, actorUserId, rid) {
      return [...rows.values()].find(
        (row) => row.projectId === pid && row.actorUserId === actorUserId && row.requestId === rid,
      ) ?? null;
    },
    async findById(id) {
      return rows.get(id) ?? null;
    },
    async listByProject({ projectId: pid, status, kind, limit }) {
      return [...rows.values()]
        .filter((row) => row.projectId === pid)
        .filter((row) => status == null || row.status === status)
        .filter((row) => kind == null || row.kind === kind)
        .slice(0, limit);
    },
    async listBySourceRunId({ projectId: pid, sourceRunId, kind }) {
      return [...rows.values()]
        .filter((row) => row.projectId === pid)
        .filter((row) => row.sourceRunId === sourceRunId)
        .filter((row) => kind == null || row.kind === kind);
    },
    async listExpiredCodePreviewActions({ now, limit }) {
      return [...rows.values()]
        .filter((row) => row.kind === "code_project.preview")
        .filter((row) => row.status === "completed")
        .filter((row) => {
          const result = row.result as { expiresAt?: unknown } | null;
          return typeof result?.expiresAt === "string"
            && new Date(result.expiresAt).getTime() <= now.getTime();
        })
        .slice(0, limit);
    },
    async insert(values) {
      const existing = await this.findByRequestId(
        values.projectId,
        values.actorUserId,
        values.requestId,
      );
      if (existing) return { action: existing, inserted: false };
      const now = new Date("2026-05-05T00:00:00.000Z").toISOString();
      const row: AgentAction = {
        id: rows.size === 0 ? actionId : `00000000-0000-4000-8000-${String(rows.size + 3).padStart(12, "0")}`,
        requestId: values.requestId,
        workspaceId: values.workspaceId,
        projectId: values.projectId,
        actorUserId: values.actorUserId,
        sourceRunId: values.sourceRunId ?? null,
        kind: values.kind,
        status: values.status,
        risk: values.risk,
        input: values.input,
        preview: values.preview ?? null,
        result: values.result ?? null,
        errorCode: values.errorCode ?? null,
        createdAt: now,
        updatedAt: now,
      };
      rows.set(row.id, row);
      return { action: row, inserted: true };
    },
    async updateStatus(id, values) {
      const current = rows.get(id);
      if (!current) return null;
      const next = {
        ...current,
        status: values.status,
        ...(values.preview !== undefined ? { preview: values.preview } : {}),
        ...(values.result !== undefined ? { result: values.result } : {}),
        ...(values.errorCode !== undefined ? { errorCode: values.errorCode } : {}),
        updatedAt: new Date("2026-05-05T00:01:00.000Z").toISOString(),
      };
      rows.set(id, next);
      return next;
    },
  };
}

function makeAction(overrides: Partial<AgentAction> = {}): AgentAction {
  return {
    id: actionId,
    requestId,
    workspaceId,
    projectId,
    actorUserId: userId,
    sourceRunId: null,
    kind: "workflow.placeholder",
    status: "draft",
    risk: "low",
    input: {},
    preview: null,
    result: null,
    errorCode: null,
    createdAt: "2026-05-05T00:00:00.000Z",
    updatedAt: "2026-05-05T00:00:00.000Z",
    ...overrides,
  };
}

function createMemoryNoteExecutor(options?: {
  failWith?: AgentActionError;
}): NoteActionExecutor & {
  calls: Array<{ kind: string }>;
  createdNoteIds: string[];
} {
  const calls: Array<{ kind: string }> = [];
  const createdNoteIds: string[] = [];
  return {
    calls,
    createdNoteIds,
    async execute(input) {
      calls.push({ kind: input.kind });
      if (options?.failWith) throw options.failWith;
      if (input.kind === "note.create") {
        const payload = input.payload as { title: string; folderId: string | null };
        const id = "00000000-0000-4000-8000-000000000090";
        createdNoteIds.push(id);
        return {
          ok: true,
          note: {
            id,
            projectId: input.projectId,
            folderId: payload.folderId ?? null,
            title: payload.title,
          },
        };
      }
      const payload = input.payload as {
        noteId: string;
        folderId?: string | null;
        title?: string;
      };
      return {
        ok: true,
        note: {
          id: payload.noteId,
          projectId: input.projectId,
          folderId: payload.folderId ?? null,
          title: payload.title ?? "test",
        },
      };
    },
  };
}

function createMemoryNoteUpdatePreviewer(): NoteUpdatePreviewer & {
  calls: Array<{ noteId: string }>;
} {
  const calls: Array<{ noteId: string }> = [];
  return {
    calls,
    async preview(input) {
      calls.push({ noteId: input.payload.noteId });
      return {
        noteId: input.payload.noteId,
        source: "yjs",
        current: {
          contentText: "old draft",
          yjsStateVectorBase64: "AQID",
        },
        draft: {
          contentText: "updated draft",
        },
        diff: {
          fromVersion: "current",
          toVersion: "current",
          summary: {
            addedBlocks: 0,
            removedBlocks: 0,
            changedBlocks: 1,
            addedWords: 1,
            removedWords: 1,
          },
          blocks: [
            {
              key: "0",
              status: "changed",
              textDiff: [
                { kind: "delete", text: "old" },
                { kind: "insert", text: "updated" },
                { kind: "equal", text: " draft" },
              ],
            },
          ],
        },
        applyConstraints: [
          "apply_must_transform_yjs_document",
          "capture_version_before_apply",
        ],
      };
    },
  };
}

function createMemoryNoteUpdateApplier(options?: {
  failWith?: AgentActionError;
}): NoteUpdateApplier & {
  calls: Array<{ actionId: string; noteId: string; expectedVector: string }>;
} {
  const calls: Array<{ actionId: string; noteId: string; expectedVector: string }> = [];
  return {
    calls,
    async apply(input) {
      calls.push({
        actionId: input.action.id,
        noteId: input.payload.noteId,
        expectedVector: input.request.yjsStateVectorBase64,
      });
      if (options?.failWith) throw options.failWith;
      return {
        ok: true,
        noteId: input.payload.noteId,
        applied: {
          source: "yjs",
          yjsStateVectorBase64: "BAUG",
          contentText: "updated draft",
        },
        versionCapture: {
          before: { created: true, version: 4 },
          after: { created: true, version: 5 },
        },
        summary: {
          changedBlocks: 1,
          addedWords: 1,
          removedWords: 1,
        },
      };
    },
  };
}
