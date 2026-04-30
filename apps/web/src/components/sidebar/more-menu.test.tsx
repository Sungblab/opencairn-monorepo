import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MoreMenu } from "./more-menu";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

vi.mock("next-intl", () => ({
  useTranslations: (ns?: string) => (key: string) =>
    ns ? `${ns}.${key}` : key,
}));

describe("MoreMenu", () => {
  beforeEach(() => {
    push.mockClear();
  });

  it("opens and routes workspace-scoped items via router.push", async () => {
    render(<MoreMenu base="/ko/workspace/acme" />);
    fireEvent.click(
      screen.getByRole("button", { name: "sidebar.nav.more_aria" }),
    );
    const settings = await screen.findByText("sidebar.more_menu.settings");
    fireEvent.click(settings);
    expect(push).toHaveBeenCalledWith("/ko/workspace/acme/settings");
  });

  it("opens external items in a new window", async () => {
    const openSpy = vi
      .spyOn(window, "open")
      .mockImplementation(() => null as unknown as Window);
    render(<MoreMenu base="/ko/workspace/acme" />);
    fireEvent.click(
      screen.getByRole("button", { name: "sidebar.nav.more_aria" }),
    );
    fireEvent.click(await screen.findByText("sidebar.more_menu.feedback"));
    expect(openSpy).toHaveBeenCalledWith(
      "/feedback",
      "_blank",
      "noopener,noreferrer",
    );
    openSpy.mockRestore();
  });
});
