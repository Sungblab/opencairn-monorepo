import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DashboardView } from "./dashboard-view";

vi.mock("next-intl", () => ({
  useLocale: () => "ko",
  useTranslations: (ns?: string) => (k: string) => (ns ? `${ns}.${k}` : k),
}));

vi.mock("./stats-row", () => ({ StatsRow: () => <div>stats</div> }));
vi.mock("./active-research-list", () => ({
  ActiveResearchList: () => <div>research</div>,
}));
vi.mock("./recent-docs-grid", () => ({
  RecentDocsGrid: () => <div>docs</div>,
}));
vi.mock("./getting-started-panel", () => ({
  GettingStartedPanel: () => <div>getting-started</div>,
}));

describe("DashboardView", () => {
  it("renders the view-all link as a full-height control", () => {
    render(<DashboardView wsSlug="acme" wsId="ws-1" />);

    expect(screen.getByText("getting-started")).toBeInTheDocument();
    expect(
      screen.getByRole("link", {
        name: "dashboard.sections.viewAll →",
      }).className,
    ).toContain("min-h-7");
  });
});
