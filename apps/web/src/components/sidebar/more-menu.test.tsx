import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MoreMenu } from "./more-menu";

vi.mock("next-intl", () => ({
  useTranslations: (ns?: string) => (key: string) =>
    ns ? `${ns}.${key}` : key,
}));

describe("MoreMenu", () => {
  it("renders workspace-scoped items as visible native links", () => {
    render(<MoreMenu base="/ko/workspace/acme" />);

    const settings = screen.getByText("sidebar.more_menu.settings");
    expect(settings.closest("a")).toHaveAttribute(
      "href",
      "/ko/workspace/acme/settings",
    );

    expect(
      screen.getByText("sidebar.more_menu.shared_links").closest("a"),
    ).toHaveAttribute(
      "href",
      "/ko/workspace/acme/settings/shared-links",
    );

    expect(
      screen.getByText("sidebar.more_menu.trash").closest("a"),
    ).toHaveAttribute("href", "/ko/workspace/acme/settings/trash");
  });

  it("renders external items as new-tab links", () => {
    render(<MoreMenu base="/ko/workspace/acme" />);

    const feedback = (
      screen.getByText("sidebar.more_menu.feedback")
    ).closest("a");
    expect(feedback).toHaveAttribute("href", "/feedback");
    expect(feedback).toHaveAttribute("target", "_blank");
    expect(feedback).toHaveAttribute("rel", "noreferrer");

    const changelog = (
      screen.getByText("sidebar.more_menu.changelog")
    ).closest("a");
    expect(changelog).toHaveAttribute("href", "/changelog");
    expect(changelog).toHaveAttribute("target", "_blank");
    expect(changelog).toHaveAttribute("rel", "noreferrer");
  });
});
