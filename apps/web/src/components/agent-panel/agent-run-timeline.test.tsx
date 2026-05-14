import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { WorkflowConsoleRun } from "@/lib/api-client";
import { AgentRunTimeline } from "./agent-run-timeline";

vi.mock("next-intl", () => ({
  useTranslations: (ns?: string) => (
    key: string,
    values?: Record<string, unknown>,
  ) => {
    const label = ns ? `${ns}.${key}` : key;
    if (!values) return label;
    return `${label}:${JSON.stringify(values)}`;
  },
}));

function run(overrides: Partial<WorkflowConsoleRun>): WorkflowConsoleRun {
  return {
    runId: "chat:run-1",
    runType: "chat",
    agentRole: "research",
    workGroupId: "chat:run-1",
    sourceId: "run-1",
    sourceStatus: "running",
    workspaceId: "workspace-1",
    projectId: "project-1",
    actorUserId: "user-1",
    title: "Analyze selected source",
    status: "running",
    risk: "low",
    progress: { current: 1, total: 3, percent: 33 },
    outputs: [],
    approvals: [],
    error: null,
    createdAt: "2026-05-14T00:00:00.000Z",
    updatedAt: "2026-05-14T00:01:00.000Z",
    completedAt: null,
    ...overrides,
  };
}

describe("AgentRunTimeline", () => {
  it("maps active workflow projections into safe product step names", () => {
    render(
      <AgentRunTimeline
        runs={[
          run({
            runId: "agent_action:action-1",
            runType: "agent_action",
            agentRole: "review",
            status: "approval_required",
            sourceStatus: "approval_required",
            approvals: [
              {
                approvalId: "approval-1",
                status: "requested",
                risk: "write",
              },
            ],
          }),
          run({
            runId: "document_generation:doc-1",
            runType: "document_generation",
            agentRole: "write",
            status: "running",
            outputs: [
              {
                outputType: "agent_file",
                id: "file-1",
                label: "report.pdf",
                url: "/api/files/file-1",
              },
            ],
          }),
          run({}),
        ]}
      />,
    );

    expect(screen.getByText("agentPanel.runTimeline.title")).toBeTruthy();
    expect(
      screen.getByText("agentPanel.runTimeline.step.searchProject"),
    ).toBeTruthy();
    expect(
      screen.getByText("agentPanel.runTimeline.step.buildPlan"),
    ).toBeTruthy();
    expect(
      screen.getByText("agentPanel.runTimeline.step.needsReview"),
    ).toBeTruthy();
    expect(
      screen.getByText("agentPanel.runTimeline.step.openArtifact"),
    ).toBeTruthy();
    expect(screen.queryByText(/thought/i)).toBeNull();
  });

  it("renders terminal failure as a recovery-oriented step", () => {
    render(
      <AgentRunTimeline
        runs={[
          run({
            status: "failed",
            sourceStatus: "failed",
            error: {
              code: "document_generation_failed",
              message: "Worker failed",
              retryable: true,
            },
          }),
        ]}
      />,
    );

    expect(
      screen.getByText("agentPanel.runTimeline.step.failed"),
    ).toBeTruthy();
    expect(screen.getByText("Worker failed")).toBeTruthy();
  });
});
