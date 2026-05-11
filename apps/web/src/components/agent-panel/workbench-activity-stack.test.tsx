import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useIngestStore } from "@/stores/ingest-store";
import { WorkbenchActivityStack } from "./workbench-activity-stack";

vi.mock("next-intl", () => ({
  useTranslations: (ns?: string) => (k: string) => (ns ? `${ns}.${k}` : k),
}));

describe("WorkbenchActivityStack", () => {
  beforeEach(() => {
    useIngestStore.setState({ runs: {}, spotlightWfid: null });
  });

  it("stays hidden when no project work is running", () => {
    render(<WorkbenchActivityStack />);
    expect(
      screen.queryByRole("region", {
        name: "agentPanel.activityStack.title",
      }),
    ).not.toBeInTheDocument();
  });

  it("shows live ingest progress inside the agent workbench", () => {
    useIngestStore.getState().startRun("wf-1", "application/pdf", "paper.pdf");

    render(<WorkbenchActivityStack />);

    expect(
      screen.getByRole("region", {
        name: "agentPanel.activityStack.title",
      }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("ingest-dock-card")).toBeInTheDocument();
    expect(screen.getByText("paper.pdf")).toBeInTheDocument();
  });

  it("does not keep completed ingest runs in active work", () => {
    useIngestStore.getState().startRun("wf-1", "application/pdf", "paper.pdf");
    useIngestStore.getState().applyEvent("wf-1", {
      seq: 1,
      kind: "completed",
      workflowId: "wf-1",
      ts: new Date().toISOString(),
      payload: {
        noteId: "note-1",
        totalDurationMs: 1000,
      },
    });

    render(<WorkbenchActivityStack />);

    expect(
      screen.queryByRole("region", {
        name: "agentPanel.activityStack.title",
      }),
    ).not.toBeInTheDocument();
  });
});
