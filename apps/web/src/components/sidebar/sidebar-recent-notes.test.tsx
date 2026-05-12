import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { dashboardApi } from "@/lib/api-client";

import { SidebarRecentNotes } from "./sidebar-recent-notes";

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

  it("renders a quiet empty state when there is no recent work", async () => {
    vi.mocked(dashboardApi.recentNotes).mockResolvedValue({ notes: [] });

    renderWithQuery(<SidebarRecentNotes wsSlug="acme" />);

    await waitFor(() =>
      expect(screen.getByText("sidebar.recent.empty")).toBeInTheDocument(),
    );
  });
});
