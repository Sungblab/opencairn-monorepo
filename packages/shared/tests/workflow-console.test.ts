import { describe, expect, it } from "vitest";
import {
  chatConsoleEventFromChatRunEvent,
  consoleEventFromAgentActionEvent,
  projectConsoleEventFromProjectObjectEvent,
  workflowConsoleEventSchema,
  workflowConsoleRunSchema,
  workflowConsoleRunFromAgentAction,
  workflowConsoleRunFromChatRun,
  workflowConsoleRunFromImportJob,
  workflowConsoleRunFromPlan8AgentRun,
  workflowConsoleRunFromSynthesisExportRun,
} from "../src/workflow-console";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const projectId = "00000000-0000-4000-8000-000000000002";
const userId = "user-1";
const createdAt = "2026-05-05T00:00:00.000Z";
const updatedAt = "2026-05-05T00:01:00.000Z";
const completedAt = "2026-05-05T00:02:00.000Z";

describe("workflow console contracts", () => {
  it("normalizes chat runs without treating stream detach as cancellation", () => {
    const run = workflowConsoleRunFromChatRun({
      id: "00000000-0000-4000-8000-000000000010",
      threadId: "00000000-0000-4000-8000-000000000011",
      userMessageId: "00000000-0000-4000-8000-000000000012",
      agentMessageId: "00000000-0000-4000-8000-000000000013",
      workspaceId,
      projectId,
      userId,
      workflowId: "chat-run-00000000-0000-4000-8000-000000000010",
      status: "complete",
      mode: "auto",
      createdAt,
      updatedAt,
      completedAt,
    });

    expect(workflowConsoleRunSchema.parse(run)).toMatchObject({
      runId: "chat:00000000-0000-4000-8000-000000000010",
      runType: "chat",
      sourceId: "00000000-0000-4000-8000-000000000010",
      status: "completed",
      sourceStatus: "complete",
      risk: "low",
      threadId: "00000000-0000-4000-8000-000000000011",
      messageId: "00000000-0000-4000-8000-000000000013",
    });
  });

  it("projects agent actions with approval and error details", () => {
    const action = {
      id: "00000000-0000-4000-8000-000000000020",
      requestId: "00000000-0000-4000-8000-000000000021",
      workspaceId,
      projectId,
      actorUserId: userId,
      sourceRunId: "chat:00000000-0000-4000-8000-000000000010",
      kind: "note.update",
      status: "approval_required",
      risk: "write",
      input: {},
      preview: {
        noteId: "00000000-0000-4000-8000-000000000022",
      },
      result: null,
      errorCode: null,
      createdAt,
      updatedAt,
    } as const;
    const run = workflowConsoleRunFromAgentAction(action);

    expect(workflowConsoleRunSchema.parse(run)).toMatchObject({
      runId: "agent_action:00000000-0000-4000-8000-000000000020",
      runType: "agent_action",
      status: "approval_required",
      title: "note.update",
      approvals: [
        {
          approvalId: "agent_action:00000000-0000-4000-8000-000000000020:approval",
          status: "requested",
          risk: "write",
        },
      ],
    });

    const failed = workflowConsoleRunFromAgentAction({
      ...action,
      status: "failed",
      errorCode: "note_update_stale_preview",
    });

    expect(failed.error).toMatchObject({
      code: "note_update_stale_preview",
      retryable: false,
    });
  });

  it("projects expired agent actions as terminal workflow console runs", () => {
    const run = workflowConsoleRunFromAgentAction({
      id: "00000000-0000-4000-8000-000000000023",
      requestId: "00000000-0000-4000-8000-000000000024",
      workspaceId,
      projectId,
      actorUserId: userId,
      sourceRunId: "chat:00000000-0000-4000-8000-000000000010",
      kind: "code_project.preview",
      status: "expired",
      risk: "external",
      input: {},
      preview: null,
      result: null,
      errorCode: "code_project_preview_expired",
      createdAt,
      updatedAt,
    });

    expect(workflowConsoleRunSchema.parse(run)).toMatchObject({
      runId: "agent_action:00000000-0000-4000-8000-000000000023",
      runType: "agent_action",
      status: "expired",
      error: {
        code: "code_project_preview_expired",
        retryable: false,
      },
    });
  });

  it("projects completed static code preview actions as preview outputs", () => {
    const run = workflowConsoleRunFromAgentAction({
      id: "00000000-0000-4000-8000-000000000023",
      requestId: "00000000-0000-4000-8000-000000000024",
      workspaceId,
      projectId,
      actorUserId: userId,
      sourceRunId: "chat:00000000-0000-4000-8000-000000000010",
      kind: "code_project.preview",
      status: "completed",
      risk: "external",
      input: {
        kind: "code_project.preview",
        risk: "external",
        codeWorkspaceId: "00000000-0000-4000-8000-000000000025",
        snapshotId: "00000000-0000-4000-8000-000000000026",
        mode: "static",
        entryPath: "index.html",
      },
      preview: null,
      result: {
        ok: true,
        kind: "code_project.preview",
        mode: "static",
        codeWorkspaceId: "00000000-0000-4000-8000-000000000025",
        snapshotId: "00000000-0000-4000-8000-000000000026",
        entryPath: "index.html",
        previewUrl:
          "/api/agent-actions/00000000-0000-4000-8000-000000000023/preview/index.html",
        assetsBaseUrl:
          "/api/agent-actions/00000000-0000-4000-8000-000000000023/preview/",
        publicPreviewUrl:
          "https://preview.example.com/api/public/agent-actions/00000000-0000-4000-8000-000000000023/preview/token/index.html",
        publicAssetsBaseUrl:
          "https://preview.example.com/api/public/agent-actions/00000000-0000-4000-8000-000000000023/preview/token/",
        expiresAt: "2026-05-06T00:00:00.000Z",
      },
      errorCode: null,
      createdAt,
      updatedAt,
    });

    expect(workflowConsoleRunSchema.parse(run)).toMatchObject({
      runId: "agent_action:00000000-0000-4000-8000-000000000023",
      runType: "agent_action",
      status: "completed",
      outputs: [
        {
          outputType: "preview",
          id: "00000000-0000-4000-8000-000000000023",
          label: "Static preview",
          url: "https://preview.example.com/api/public/agent-actions/00000000-0000-4000-8000-000000000023/preview/token/index.html",
          metadata: {
            codeWorkspaceId: "00000000-0000-4000-8000-000000000025",
            snapshotId: "00000000-0000-4000-8000-000000000026",
            entryPath: "index.html",
            expiresAt: "2026-05-06T00:00:00.000Z",
          },
        },
      ],
    });
  });

  it("projects completed provider file exports as provider URL outputs", () => {
    const run = workflowConsoleRunFromAgentAction({
      id: "00000000-0000-4000-8000-000000000027",
      requestId: "00000000-0000-4000-8000-000000000028",
      workspaceId,
      projectId,
      actorUserId: userId,
      sourceRunId: "chat:00000000-0000-4000-8000-000000000010",
      kind: "file.export",
      status: "completed",
      risk: "external",
      input: {
        type: "export_project_object",
        objectId: "00000000-0000-4000-8000-000000000029",
        provider: "google_docs",
        format: "docx",
      },
      preview: null,
      result: {
        ok: true,
        requestId: "00000000-0000-4000-8000-000000000028",
        workflowId: "google-workspace-export/00000000-0000-4000-8000-000000000028",
        objectId: "00000000-0000-4000-8000-000000000029",
        provider: "google_docs",
        externalObjectId: "google-doc-1",
        externalUrl: "https://docs.google.com/document/d/google-doc-1/edit",
        exportedMimeType: "application/vnd.google-apps.document",
        exportStatus: "completed",
      },
      errorCode: null,
      createdAt,
      updatedAt,
    });

    expect(workflowConsoleRunSchema.parse(run)).toMatchObject({
      runId: "agent_action:00000000-0000-4000-8000-000000000027",
      runType: "agent_action",
      status: "completed",
      outputs: [
        {
          outputType: "provider_url",
          id: "google-doc-1",
          label: "google_docs",
          url: "https://docs.google.com/document/d/google-doc-1/edit",
          mimeType: "application/vnd.google-apps.document",
          metadata: {
            provider: "google_docs",
            objectId: "00000000-0000-4000-8000-000000000029",
            exportStatus: "completed",
          },
        },
      ],
    });
  });

  it("projects completed code install actions as log outputs", () => {
    const run = workflowConsoleRunFromAgentAction({
      id: "00000000-0000-4000-8000-000000000037",
      requestId: "00000000-0000-4000-8000-000000000038",
      workspaceId,
      projectId,
      actorUserId: userId,
      sourceRunId: "chat:00000000-0000-4000-8000-000000000010",
      kind: "code_project.install",
      status: "completed",
      risk: "external",
      input: {
        codeWorkspaceId: "00000000-0000-4000-8000-000000000039",
        snapshotId: "00000000-0000-4000-8000-000000000040",
        packageManager: "pnpm",
        packages: [{ name: "zod", version: "3.25.0", dev: false }],
        network: "required",
      },
      preview: null,
      result: {
        ok: true,
        codeWorkspaceId: "00000000-0000-4000-8000-000000000039",
        snapshotId: "00000000-0000-4000-8000-000000000040",
        packageManager: "pnpm",
        installed: [{ name: "zod", version: "3.25.0", dev: false }],
        exitCode: 0,
        durationMs: 42,
        logs: [{ stream: "stdout", text: "install passed" }],
      },
      errorCode: null,
      createdAt,
      updatedAt,
    });

    expect(workflowConsoleRunSchema.parse(run)).toMatchObject({
      runId: "agent_action:00000000-0000-4000-8000-000000000037",
      runType: "agent_action",
      status: "completed",
      outputs: [
        {
          outputType: "log",
          id: "00000000-0000-4000-8000-000000000037:install",
          label: "Dependency install",
          metadata: {
            codeWorkspaceId: "00000000-0000-4000-8000-000000000039",
            snapshotId: "00000000-0000-4000-8000-000000000040",
            packageManager: "pnpm",
            installed: [{ name: "zod", version: "3.25.0", dev: false }],
            exitCode: 0,
            durationMs: 42,
          },
        },
      ],
    });
  });

  it("projects chat run events with replay sequence and normalized event family", () => {
    const event = chatConsoleEventFromChatRunEvent({
      runId: "00000000-0000-4000-8000-000000000010",
      seq: 7,
      event: "status",
      payload: { label: "Searching sources" },
      createdAt,
    });

    expect(workflowConsoleEventSchema.parse(event)).toMatchObject({
      runId: "chat:00000000-0000-4000-8000-000000000010",
      seq: 7,
      eventType: "run.progress",
      sourceEventType: "status",
      payload: { label: "Searching sources" },
      createdAt,
    });
  });

  it("projects agent action status events into console status events", () => {
    const event = consoleEventFromAgentActionEvent({
      type: "agent_action_status",
      action: {
        id: "00000000-0000-4000-8000-000000000020",
        requestId: "00000000-0000-4000-8000-000000000021",
        workspaceId,
        projectId,
        actorUserId: userId,
        sourceRunId: null,
        kind: "file.generate",
        status: "running",
        risk: "expensive",
        input: {},
        preview: null,
        result: null,
        errorCode: null,
        createdAt,
        updatedAt,
      },
    });

    expect(workflowConsoleEventSchema.parse(event)).toMatchObject({
      runId: "agent_action:00000000-0000-4000-8000-000000000020",
      eventType: "run.status_changed",
      sourceEventType: "agent_action_status",
      sourceStatus: "running",
      status: "running",
    });
  });

  it("projects document generation events into console events and outputs", () => {
    const event = projectConsoleEventFromProjectObjectEvent({
      type: "project_object_generation_completed",
      result: {
        ok: true,
        requestId: "00000000-0000-4000-8000-000000000030",
        workflowId: "document-generation/00000000-0000-4000-8000-000000000030",
        format: "pdf",
        object: {
          id: "00000000-0000-4000-8000-000000000031",
          objectType: "agent_file",
          title: "Report",
          filename: "report.pdf",
          kind: "pdf",
          mimeType: "application/pdf",
          projectId,
        },
        artifact: {
          objectKey: "agent-files/project/report.pdf",
          mimeType: "application/pdf",
          bytes: 1200,
        },
      },
    });

    expect(workflowConsoleEventSchema.parse(event)).toMatchObject({
      runId: "document_generation:00000000-0000-4000-8000-000000000030",
      eventType: "run.output_added",
      sourceEventType: "project_object_generation_completed",
      output: {
        outputType: "agent_file",
        id: "00000000-0000-4000-8000-000000000031",
        label: "Report",
        mimeType: "application/pdf",
      },
    });
  });

  it("normalizes Plan8 summaries with cost and failure state", () => {
    const run = workflowConsoleRunFromPlan8AgentRun({
      runId: "00000000-0000-4000-8000-000000000040",
      workspaceId,
      projectId,
      userId,
      agentName: "librarian",
      workflowId: "plan8-librarian/00000000-0000-4000-8000-000000000040",
      status: "awaiting_input",
      startedAt: createdAt,
      endedAt: null,
      totalCostKrw: 17,
      errorMessage: null,
    });

    expect(workflowConsoleRunSchema.parse(run)).toMatchObject({
      runId: "plan8_agent:00000000-0000-4000-8000-000000000040",
      runType: "plan8_agent",
      status: "blocked",
      sourceStatus: "awaiting_input",
      cost: {
        krw: 17,
      },
    });
  });

  it("normalizes import jobs with progress and terminal error details", () => {
    const run = workflowConsoleRunFromImportJob({
      id: "00000000-0000-4000-8000-000000000050",
      workspaceId,
      projectId,
      userId,
      source: "markdown_zip",
      workflowId: "import/00000000-0000-4000-8000-000000000050",
      status: "failed",
      totalItems: 10,
      completedItems: 6,
      failedItems: 2,
      sourceMetadata: { filename: "vault.zip" },
      errorSummary: "Import could not be started. Please try again.",
      createdAt,
      updatedAt,
      completedAt,
    });

    expect(workflowConsoleRunSchema.parse(run)).toMatchObject({
      runId: "import:00000000-0000-4000-8000-000000000050",
      runType: "import",
      status: "failed",
      sourceStatus: "failed",
      title: "Import markdown_zip",
      progress: {
        current: 8,
        total: 10,
        percent: 80,
      },
      error: {
        code: "import_failed",
        message: "Import could not be started. Please try again.",
        retryable: true,
      },
      outputs: [
        {
          outputType: "import",
          id: "00000000-0000-4000-8000-000000000050",
          label: "vault.zip",
        },
      ],
    });
  });

  it("normalizes synthesis export runs with document outputs", () => {
    const run = workflowConsoleRunFromSynthesisExportRun({
      runId: "00000000-0000-4000-8000-000000000060",
      workspaceId,
      projectId,
      userId,
      workflowId: "synthesis-export/00000000-0000-4000-8000-000000000060",
      status: "completed",
      format: "pdf",
      template: "report",
      userPrompt: "Generate an implementation report",
      tokensUsed: 1200,
      createdAt,
      updatedAt,
      documents: [
        {
          id: "00000000-0000-4000-8000-000000000061",
          format: "pdf",
          bytes: 4096,
          url: "/api/synthesis-export/runs/00000000-0000-4000-8000-000000000060/document",
        },
      ],
    });

    expect(workflowConsoleRunSchema.parse(run)).toMatchObject({
      runId: "export:00000000-0000-4000-8000-000000000060",
      runType: "export",
      status: "completed",
      sourceStatus: "completed",
      title: "Export pdf",
      cost: {
        outputTokens: 1200,
      },
      outputs: [
        {
          outputType: "export",
          id: "00000000-0000-4000-8000-000000000061",
          label: "pdf export",
          bytes: 4096,
        },
      ],
    });
  });
});
