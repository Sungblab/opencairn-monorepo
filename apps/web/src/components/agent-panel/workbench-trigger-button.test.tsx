import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import projectMessages from "../../../messages/ko/project.json";
import { useAgentWorkbenchStore } from "@/stores/agent-workbench-store";
import { usePanelStore } from "@/stores/panel-store";
import { studioToolsApi } from "@/lib/api-client";
import {
  WorkbenchActivityButton,
  WorkbenchCommandButton,
  WorkbenchContextButton,
} from "./workbench-trigger-button";

vi.mock("@/lib/api-client", () => ({
  studioToolsApi: {
    preflight: vi.fn(),
  },
}));

function resetStores() {
  localStorage.clear();
  vi.clearAllMocks();
  useAgentWorkbenchStore.setState(useAgentWorkbenchStore.getInitialState(), true);
  usePanelStore.setState(usePanelStore.getInitialState(), true);
}

function renderWithIntl(ui: ReactNode) {
  return render(
    <NextIntlClientProvider
      locale="ko"
      messages={{ project: projectMessages }}
    >
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("workbench trigger buttons", () => {
  beforeEach(resetStores);

  it("opens the right panel chat tab and queues a command", async () => {
    usePanelStore.getState().setAgentPanelOpen(false);

    renderWithIntl(
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

    renderWithIntl(<WorkbenchActivityButton>Activity</WorkbenchActivityButton>);

    await userEvent.click(screen.getByRole("button", { name: "Activity" }));

    expect(usePanelStore.getState().agentPanelOpen).toBe(true);
    expect(usePanelStore.getState().agentPanelTab).toBe("activity");
    expect(useAgentWorkbenchStore.getState().pendingIntent).toBeNull();
  });

  it("opens chat and queues a context-only command without sending immediately", async () => {
    renderWithIntl(
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

  it("blocks command launch when Studio preflight reports insufficient credits", async () => {
    vi.mocked(studioToolsApi.preflight).mockResolvedValue({
      preflight: {
        tool: "summary",
        projectId: "project-1",
        provider: "gemini",
        model: "gemini-3-flash-preview",
        billingPath: "managed",
        chargeRequired: true,
        requiresConfirmation: false,
        sourceTokenEstimate: 8000,
        cachedTokenEstimate: 0,
        profile: {
          executionClass: "durable_run",
          sourceTokenCap: 8000,
          tokensIn: 8000,
          tokensOut: 8000,
          featureMultiplier: 1,
          requiresConfirmation: false,
        },
        cost: {
          tokensIn: 8000,
          tokensOut: 8000,
          cachedTokens: 0,
          searchQueries: 0,
          pricingTier: "flash",
          costUsd: 0,
          costKrw: 42,
          billableCredits: 42,
        },
        balance: {
          availableCredits: 0,
          plan: "free",
        },
        canStart: false,
        blockedReason: "credits_insufficient",
      },
    });
    usePanelStore.getState().setAgentPanelOpen(false);

    renderWithIntl(
      <WorkbenchCommandButton
        commandId="summarize"
        preflight={{
          projectId: "project-1",
          profile: "summary",
          sourceTokenEstimate: 8000,
        }}
      >
        Summary
      </WorkbenchCommandButton>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Summary" }));

    expect(studioToolsApi.preflight).toHaveBeenCalledWith("project-1", {
      tool: "summary",
      sourceTokenEstimate: 8000,
      cachedTokenEstimate: undefined,
    });
    expect(usePanelStore.getState().agentPanelOpen).toBe(false);
    expect(useAgentWorkbenchStore.getState().pendingIntent).toBeNull();
    expect(
      screen.getByText("credits가 부족합니다. 필요 42, 보유 0."),
    ).toBeInTheDocument();
  });

  it("requires confirmation before launching costly preflighted commands", async () => {
    vi.mocked(studioToolsApi.preflight).mockResolvedValue({
      preflight: {
        tool: "deep_research",
        projectId: "project-1",
        provider: "gemini",
        model: "gemini-3-flash-preview",
        billingPath: "managed",
        chargeRequired: true,
        requiresConfirmation: true,
        sourceTokenEstimate: 48000,
        cachedTokenEstimate: 0,
        profile: {
          executionClass: "durable_run",
          sourceTokenCap: 48000,
          tokensIn: 48000,
          tokensOut: 12000,
          featureMultiplier: 1,
          requiresConfirmation: true,
        },
        cost: {
          tokensIn: 48000,
          tokensOut: 12000,
          cachedTokens: 0,
          searchQueries: 0,
          pricingTier: "flash",
          costUsd: 0,
          costKrw: 100,
          billableCredits: 100,
        },
        balance: {
          availableCredits: 1000,
          plan: "free",
        },
        canStart: true,
        blockedReason: null,
      },
    });

    renderWithIntl(
      <WorkbenchCommandButton
        commandId="research"
        preflight={{
          projectId: "project-1",
          profile: "deep_research",
          sourceTokenEstimate: 48000,
        }}
      >
        Research
      </WorkbenchCommandButton>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Research" }));
    expect(useAgentWorkbenchStore.getState().pendingIntent).toBeNull();

    await userEvent.click(
      screen.getByRole("button", {
        name: "시작",
      }),
    );

    expect(usePanelStore.getState().agentPanelTab).toBe("chat");
    expect(useAgentWorkbenchStore.getState().pendingIntent).toMatchObject({
      kind: "runCommand",
      commandId: "research",
    });
  });
});
