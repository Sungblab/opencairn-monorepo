import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LanguageSwitcher } from "./LanguageSwitcher";

vi.mock("next-intl", () => ({
  useLocale: () => "ko",
  useTranslations: (ns?: string) => (key: string) =>
    ns ? `${ns}.${key}` : key,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/ko",
  useRouter: () => ({ push: vi.fn() }),
}));

describe("LanguageSwitcher", () => {
  it("persists the selected app language in the locale cookie", async () => {
    render(<LanguageSwitcher tone="dark" />);

    fireEvent.click(
      screen.getByRole("button", { name: "common.language.menuLabel" }),
    );
    fireEvent.click(await screen.findByText("English"));

    expect(document.cookie).toContain("NEXT_LOCALE=en");
  });

  it("lets footer usage constrain the popup width on narrow screens", async () => {
    render(
      <LanguageSwitcher
        tone="dark"
        className="w-full justify-center sm:w-auto"
        contentClassName="sm:!w-56"
      />,
    );

    const trigger = screen.getByRole("button", {
      name: "common.language.menuLabel",
    });
    expect(trigger).toHaveClass("w-full", "justify-center", "sm:w-auto");

    fireEvent.click(trigger);

    const content = await screen.findByText("English").then((node) =>
      node.closest('[data-slot="dropdown-menu-content"]'),
    );
    expect(content).toHaveClass("sm:!w-56");
  });

  it("keeps dark-tone menu labels inheriting inverted item text color", async () => {
    render(<LanguageSwitcher tone="dark" />);

    fireEvent.click(
      screen.getByRole("button", { name: "common.language.menuLabel" }),
    );

    const label = await screen.findByText("English");
    expect(label).toHaveClass("text-current");
  });
});
