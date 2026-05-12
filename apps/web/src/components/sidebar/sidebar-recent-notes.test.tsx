import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { dashboardApi } from "@/lib/api-client";
import { useAgentWorkbenchStore } from "@/stores/agent-workbench-store";
import { usePanelStore } from "@/stores/panel-store";
import { useTabsStore } from "@/stores/tabs-store";

import { SidebarRecentNotes } from "./sidebar-recent-notes";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

vi.mock("next-intl", () => ({
  useLocale: () => "ko",
  useTranslations: (ns?: string) => (key: string) =>
    ns ? `${ns}.${key}` : key,
}));

vi.mock("@/hooks/useWorkspaceId", () => ({
  useWorkspaceId: () => "workspace-1",
}));

vi.mock("@/lib/api-client", () => ({
  dashboardApi: {
    recentNotes: vi.fn(),
  },
}));

function renderWithQuery(ui: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

describe("SidebarRecentNotes", () => {
  beforeEach(() => {
    vi.mocked(dashboardApi.recentNotes).mockReset();
    push.mockClear();
    window.localStorage.clear();
    useAgentWorkbenchStore.setState(
      useAgentWorkbenchStore.getInitialState(),
      true,
    );
    usePanelStore.setState(usePanelStore.getInitialState(), true);
    useTabsStore.setState(useTabsStore.getInitialState(), true);
  });

  it("shows recent workspace notes as direct note links", async () => {
    vi.mocked(dashboardApi.recentNotes).mockResolvedValue({
      notes: [
        {
          id: "note-1",
          title: "최근 리서치",
          project_id: "project-1",
          project_name: "서비스 에이전트",
          updated_at: "2026-05-12T01:00:00Z",
          excerpt: "요약",
        },
      ],
    });

    renderWithQuery(<SidebarRecentNotes wsSlug="acme" />);

    await waitFor(() =>
      expect(screen.getByText("최근 리서치")).toBeInTheDocument(),
    );
    expect(screen.getByText("서비스 에이전트")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /최근 리서치/ })).toHaveAttribute(
      "href",
      "/ko/workspace/acme/note/note-1",
    );
  });

  it("opens a recent note in the editor tab and scopes the agent panel to it", async () => {
    vi.mocked(dashboardApi.recentNotes).mockResolvedValue({
      notes: [
        {
          id: "note-1",
          title: "최근 리서치",
          project_id: "project-1",
          project_name: "서비스 에이전트",
          updated_at: "2026-05-12T01:00:00Z",
          excerpt: "요약",
        },
      ],
    });

    renderWithQuery(<SidebarRecentNotes wsSlug="acme" />);

    await waitFor(() =>
      expect(screen.getByText("최근 리서치")).toBeInTheDocument(),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "sidebar.agent_actions.ask_ai",
      }),
    );

    expect(push).toHaveBeenCalledWith("/ko/workspace/acme/note/note-1");
    expect(useTabsStore.getState().tabs[0]).toMatchObject({
      kind: "note",
      targetId: "note-1",
      mode: "plate",
      title: "최근 리서치",
    });
    expect(useAgentWorkbenchStore.getState().pendingIntent).toMatchObject({
      kind: "applyContext",
      commandId: "current_document_only",
    });
    expect(usePanelStore.getState()).toMatchObject({
      agentPanelOpen: true,
      agentPanelTab: "chat",
    });
  });

  it("renders a quiet empty state when there is no recent work", async () => {
    vi.mocked(dashboardApi.recentNotes).mockResolvedValue({ notes: [] });

    renderWithQuery(<SidebarRecentNotes wsSlug="acme" />);

    await waitFor(() =>
      expect(screen.getByText("sidebar.recent.empty")).toBeInTheDocument(),
    );
  });
});
