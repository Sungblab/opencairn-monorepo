import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { GettingStartedPanel } from "./getting-started-panel";
import { dashboardApi } from "@/lib/api-client";

vi.mock("next-intl", () => ({
  useLocale: () => "ko",
  useTranslations: (ns?: string) => (k: string) => (ns ? `${ns}.${k}` : k),
}));

vi.mock("@/lib/api-client", () => ({
  dashboardApi: {
    stats: vi.fn(),
    recentNotes: vi.fn(),
    researchRuns: vi.fn(),
  },
}));

vi.mock("@/components/import/first-source-intake", () => ({
  FirstSourceIntake: ({ initialMode }: { initialMode: string }) => (
    <div>dashboard first-source {initialMode}</div>
  ),
}));

function renderPanel() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <GettingStartedPanel wsId="ws-1" wsSlug="acme" />
    </QueryClientProvider>,
  );
}

describe("GettingStartedPanel", () => {
  it("shows the file/link/text first-source intake for a new empty workspace", async () => {
    vi.mocked(dashboardApi.stats).mockResolvedValue({
      docs: 0,
      docs_week_delta: 0,
      research_in_progress: 0,
      credits_krw: 0,
      byok_connected: false,
    });
    vi.mocked(dashboardApi.recentNotes).mockResolvedValue({ notes: [] });
    vi.mocked(dashboardApi.researchRuns).mockResolvedValue({ runs: [] });

    renderPanel();

    expect(
      await screen.findByText("dashboard.gettingStarted.titleEmpty"),
    ).toBeInTheDocument();
    const panel = screen.getByRole("region", {
      name: "dashboard.gettingStarted.titleEmpty",
    });
    expect(panel).toHaveClass(
      "rounded-[var(--radius-card)]",
      "border",
      "border-border",
      "bg-background",
    );
    expect(panel).not.toHaveClass("border-2");
    expect(screen.getByText("dashboard first-source file")).toBeInTheDocument();
  });

  it("switches copy once the workspace has content", async () => {
    vi.mocked(dashboardApi.stats).mockResolvedValue({
      docs: 2,
      docs_week_delta: 1,
      research_in_progress: 0,
      credits_krw: 0,
      byok_connected: false,
    });
    vi.mocked(dashboardApi.recentNotes).mockResolvedValue({
      notes: [
        {
          id: "note-1",
          title: "Brief",
          project_id: "project-1",
          project_name: "Research",
          updated_at: "2026-05-06T00:00:00Z",
          excerpt: "A note",
        },
      ],
    });
    vi.mocked(dashboardApi.researchRuns).mockResolvedValue({ runs: [] });

    renderPanel();

    expect(
      await screen.findByText("dashboard.gettingStarted.titleActive"),
    ).toBeInTheDocument();
  });
});
