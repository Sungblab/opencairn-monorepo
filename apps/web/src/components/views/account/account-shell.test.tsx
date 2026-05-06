import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AccountShell } from "./account-shell";

vi.mock("next-intl", () => ({
  useLocale: () => "ko",
  useTranslations: (ns?: string) => (k: string) => (ns ? `${ns}.${k}` : k),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/ko/settings/profile",
}));

describe("AccountShell", () => {
  it("stacks navigation above content on small screens", () => {
    render(
      <AccountShell>
        <h1>Profile content</h1>
      </AccountShell>,
    );

    const shell = screen.getByTestId("account-shell");
    const nav = screen.getByRole("navigation", { name: "account.title" });

    expect(shell.className).toContain("flex-col");
    expect(shell.className).toContain("md:flex-row");
    expect(nav.className).toContain("flex-row");
    expect(nav.className).toContain("overflow-x-auto");
  });

  it("keeps the active tab readable against its active background", () => {
    render(
      <AccountShell>
        <h1>Profile content</h1>
      </AccountShell>,
    );

    const active = screen.getByRole("link", { name: "account.tabs.profile" });
    const inactive = screen.getByRole("link", {
      name: "account.tabs.notifications",
    });

    expect(active.className).toContain("bg-muted");
    expect(active.className).toContain("text-foreground");
    expect(inactive.className).toContain("hover:bg-muted");
    expect(inactive.className).not.toContain("hover:bg-accent");
  });
});
