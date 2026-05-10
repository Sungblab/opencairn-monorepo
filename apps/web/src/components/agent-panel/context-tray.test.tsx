import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ContextTray } from "./context-tray";

vi.mock("next-intl", () => ({
  useTranslations: (ns?: string) => (k: string) => (ns ? `${ns}.${k}` : k),
}));

describe("ContextTray", () => {
  it("summarizes automatic project context without exposing internal scope toggles", () => {
    render(
      <ContextTray
        activeKind="note"
        sourcePolicy="auto_project"
        memoryPolicy="auto"
        externalSearch="off"
        onSourcePolicyChange={vi.fn()}
        onMemoryPolicyChange={vi.fn()}
        onExternalSearchChange={vi.fn()}
      />,
    );

    expect(
      screen.getByText("agentPanel.contextTray.summary.currentDocumentProjectMemory"),
    ).toBeInTheDocument();
    expect(screen.queryByText("agentPanel.scope.chips.page")).not.toBeInTheDocument();
    expect(screen.queryByText("agentPanel.scope.chips.workspace")).not.toBeInTheDocument();
    expect(screen.queryByText("agentPanel.scope.chips.memory")).not.toBeInTheDocument();
    expect(screen.queryByText("agentPanel.scope.strict")).not.toBeInTheDocument();
  });

  it("lets users choose natural-language context policies", () => {
    const onSourcePolicyChange = vi.fn();
    render(
      <ContextTray
        activeKind="project"
        sourcePolicy="auto_project"
        memoryPolicy="auto"
        externalSearch="off"
        onSourcePolicyChange={onSourcePolicyChange}
        onMemoryPolicyChange={vi.fn()}
        onExternalSearchChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", {
      name: "agentPanel.contextTray.change_aria",
    }));
    fireEvent.click(screen.getByRole("menuitem", {
      name: "agentPanel.contextTray.policy.current_only",
    }));

    expect(onSourcePolicyChange).toHaveBeenCalledWith("current_only");
  });
});
