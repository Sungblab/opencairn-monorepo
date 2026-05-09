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

  it("uses the shared app shell surface and control tokens", () => {
    render(<DashboardView wsSlug="acme" wsId="ws-1" />);

    const header = screen.getByRole("heading", { name: "dashboard.title" }).closest("header");
    expect(header).toHaveClass(
      "rounded-[var(--radius-card)]",
      "border",
      "border-border",
      "bg-background",
    );
    expect(header).not.toHaveClass("rounded", "border-2");

    expect(
      screen.getByRole("link", { name: "dashboard.newProject" }),
    ).toHaveClass("rounded-[var(--radius-control)]");
    expect(
      screen.getByRole("link", {
        name: "dashboard.sections.viewAll →",
      }),
    ).toHaveClass("app-btn-ghost", "rounded-[var(--radius-control)]");
  });
});
