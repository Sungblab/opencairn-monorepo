import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ScopeChipsRow } from "./scope-chips-row";

vi.mock("next-intl", () => ({
  useTranslations: (ns?: string) => (k: string) => (ns ? `${ns}.${k}` : k),
}));

vi.mock("@/stores/tabs-store", () => ({
  useTabsStore: (selector: (s: { activeId: null; tabs: [] }) => unknown) =>
    selector({ activeId: null, tabs: [] }),
}));

describe("ScopeChipsRow", () => {
  it("renders chips as full-height controls", () => {
    render(
      <ScopeChipsRow
        selected={["workspace"]}
        onChange={vi.fn()}
        strict="strict"
        onStrictChange={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", {
        name: "agentPanel.scope.chips.workspace",
      }).className,
    ).toContain("min-h-7");
    expect(
      screen.getByRole("button", {
        name: "agentPanel.scope.strict_aria",
      }).className,
    ).toContain("min-h-7");
  });

  it("keeps visible scope labels free of emoji glyphs", () => {
    render(
      <ScopeChipsRow
        selected={["workspace"]}
        onChange={vi.fn()}
        strict="strict"
        onStrictChange={vi.fn()}
      />,
    );

    const workspace = screen.getByRole("button", {
      name: "agentPanel.scope.chips.workspace",
    });
    expect(workspace.textContent).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
    expect(workspace.querySelector("svg")).not.toBeNull();
  });
});
