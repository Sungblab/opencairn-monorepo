import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MoreMenu } from "./more-menu";

vi.mock("next-intl", () => ({
  useTranslations: (ns?: string) => (key: string) =>
    ns ? `${ns}.${key}` : key,
}));

describe("MoreMenu", () => {
  it("opens workspace-scoped items as native links", async () => {
    render(<MoreMenu base="/ko/app/w/acme" />);
    fireEvent.click(
      screen.getByRole("button", { name: "sidebar.nav.more_aria" }),
    );
    const settings = await screen.findByText("sidebar.more_menu.settings");
    expect(settings.closest("a")).toHaveAttribute(
      "href",
      "/ko/app/w/acme/settings",
    );

    expect(
      (await screen.findByText("sidebar.more_menu.shared_links")).closest("a"),
    ).toHaveAttribute(
      "href",
      "/ko/app/w/acme/settings/shared-links",
    );

    expect(
      (await screen.findByText("sidebar.more_menu.trash")).closest("a"),
    ).toHaveAttribute(
      "href",
      "/ko/app/w/acme/settings/trash",
    );
  });

  it("renders external items as new-tab links", async () => {
    render(<MoreMenu base="/ko/app/w/acme" />);
    fireEvent.click(
      screen.getByRole("button", { name: "sidebar.nav.more_aria" }),
    );
    const feedback = (
      await screen.findByText("sidebar.more_menu.feedback")
    ).closest("a");
    expect(feedback).toHaveAttribute("href", "/feedback");
    expect(feedback).toHaveAttribute("target", "_blank");
    expect(feedback).toHaveAttribute("rel", "noreferrer");

    const changelog = (
      await screen.findByText("sidebar.more_menu.changelog")
    ).closest("a");
    expect(changelog).toHaveAttribute("href", "/changelog");
    expect(changelog).toHaveAttribute("target", "_blank");
    expect(changelog).toHaveAttribute("rel", "noreferrer");
  });
});
