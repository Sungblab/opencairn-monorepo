import { describe, expect, it } from "vitest";
import {
  chatConsoleEventFromChatRunEvent,
  consoleEventFromAgentActionEvent,
  projectConsoleEventFromProjectObjectEvent,
  workflowConsoleEventSchema,
  workflowConsoleRunSchema,
  workflowConsoleRunFromAgentAction,
  workflowConsoleRunFromChatRun,
  workflowConsoleRunFromPlan8AgentRun,
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
});
