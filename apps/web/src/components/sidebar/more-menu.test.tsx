import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MoreMenu } from "./more-menu";

vi.mock("next-intl", () => ({
  useTranslations: (ns?: string) => (key: string) =>
    ns ? `${ns}.${key}` : key,
}));

describe("MoreMenu", () => {
  it("keeps more menu focused on gated overflow-only utilities", () => {
    render(<MoreMenu base="/ko/workspace/acme" />);

    expect(
      screen.queryByText("sidebar.more_menu.atlas"),
    ).not.toBeInTheDocument();

    expect(screen.queryByText("sidebar.more_menu.settings")).not.toBeInTheDocument();
    expect(screen.queryByText("sidebar.more_menu.shared_links")).not.toBeInTheDocument();
    expect(screen.queryByText("sidebar.more_menu.trash")).not.toBeInTheDocument();
    expect(screen.queryByText("sidebar.more_menu.feedback")).not.toBeInTheDocument();
    expect(screen.queryByText("sidebar.more_menu.changelog")).not.toBeInTheDocument();
  });

  it("renders synthesis export only when the feature is enabled", () => {
    render(<MoreMenu base="/ko/workspace/acme" synthesisExportEnabled />);

    expect(
      screen.getByText("sidebar.more_menu.synthesis_export").closest("a"),
    ).toHaveAttribute("href", "/ko/workspace/acme/synthesis-export");
  });
});
