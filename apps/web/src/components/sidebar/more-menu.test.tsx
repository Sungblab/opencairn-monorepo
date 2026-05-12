import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MoreMenu } from "./more-menu";

vi.mock("next-intl", () => ({
  useTranslations: (ns?: string) => (key: string) =>
    ns ? `${ns}.${key}` : key,
}));

describe("MoreMenu", () => {
  it("renders workspace-scoped items and opens trash in-place", async () => {
    const user = userEvent.setup();
    const onOpenTrash = vi.fn();
    render(<MoreMenu base="/ko/workspace/acme" onOpenTrash={onOpenTrash} />);

    expect(
      screen.getByText("sidebar.more_menu.atlas").closest("a"),
    ).toHaveAttribute("href", "/ko/workspace/acme/atlas");

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

    const trash = screen.getByRole("button", {
      name: "sidebar.more_menu.trash",
    });
    expect(trash.closest("a")).toBeNull();
    await user.click(trash);
    expect(onOpenTrash).toHaveBeenCalledTimes(1);
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
