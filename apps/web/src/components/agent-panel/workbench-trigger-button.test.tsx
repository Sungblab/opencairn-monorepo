import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { useAgentWorkbenchStore } from "@/stores/agent-workbench-store";
import { usePanelStore } from "@/stores/panel-store";
import {
  WorkbenchActivityButton,
  WorkbenchCommandButton,
  WorkbenchContextButton,
} from "./workbench-trigger-button";

function resetStores() {
  localStorage.clear();
  useAgentWorkbenchStore.setState(useAgentWorkbenchStore.getInitialState(), true);
  usePanelStore.setState(usePanelStore.getInitialState(), true);
}

describe("workbench trigger buttons", () => {
  beforeEach(resetStores);

  it("opens the right panel chat tab and queues a command", async () => {
    usePanelStore.getState().setAgentPanelOpen(false);

    render(
      <WorkbenchCommandButton commandId="research">
        Research
      </WorkbenchCommandButton>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Research" }));

    expect(usePanelStore.getState().agentPanelOpen).toBe(true);
    expect(usePanelStore.getState().compactAgentPanelOpen).toBe(true);
    expect(usePanelStore.getState().agentPanelTab).toBe("chat");
    expect(useAgentWorkbenchStore.getState().pendingIntent).toMatchObject({
      kind: "runCommand",
      commandId: "research",
    });
  });

  it("opens the activity tab without sending a chat command", async () => {
    usePanelStore.getState().setAgentPanelOpen(false);

    render(<WorkbenchActivityButton>Activity</WorkbenchActivityButton>);

    await userEvent.click(screen.getByRole("button", { name: "Activity" }));

    expect(usePanelStore.getState().agentPanelOpen).toBe(true);
    expect(usePanelStore.getState().agentPanelTab).toBe("activity");
    expect(useAgentWorkbenchStore.getState().pendingIntent).toBeNull();
  });

  it("opens chat and queues a context-only command without sending immediately", async () => {
    render(
      <WorkbenchContextButton commandId="current_document_only">
        Ask AI
      </WorkbenchContextButton>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Ask AI" }));

    expect(usePanelStore.getState().agentPanelTab).toBe("chat");
    expect(useAgentWorkbenchStore.getState().pendingIntent).toMatchObject({
      kind: "applyContext",
      commandId: "current_document_only",
    });
  });
});
