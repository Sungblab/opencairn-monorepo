import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AccountShell } from "./account-shell";
import type { AccountShellLabels } from "./account-shell-config";

const labels: AccountShellLabels = {
  title: "account.title",
  back: "account.back",
  tabs: {
    profile: "account.tabs.profile",
    providers: "account.tabs.providers",
    mcp: "account.tabs.mcp",
    security: "account.tabs.security",
    notifications: "account.tabs.notifications",
    billing: "account.tabs.billing",
  },
};

describe("AccountShell", () => {
  it("stacks navigation above content on small screens", () => {
    render(
      <AccountShell locale="ko" labels={labels}>
        <h1>Profile content</h1>
      </AccountShell>,
    );

    const shell = screen.getByTestId("account-shell");
    const nav = screen.getByRole("navigation", { name: "account.title" });

    expect(shell.className).toContain("flex-col");
    expect(shell.className).toContain("lg:flex-row");
    expect(nav.className).toContain("flex");
    expect(nav.className).toContain("overflow-x-auto");
    expect(nav.className).toContain("lg:flex-col");
  });

  it("keeps the active tab readable against its active background", () => {
    render(
      <AccountShell locale="ko" labels={labels}>
        <h1>Profile content</h1>
      </AccountShell>,
    );

    const active = screen.getByRole("link", { name: "account.tabs.profile" });
    const inactive = screen.getByRole("link", {
      name: "account.tabs.notifications",
    });

    expect(active.className).toContain("bg-foreground");
    expect(active.className).toContain("text-background");
    expect(inactive.className).toContain("hover:bg-muted");
    expect(inactive.className).not.toContain("hover:bg-accent");
  });
});
