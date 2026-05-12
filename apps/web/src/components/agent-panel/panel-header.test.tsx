import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PanelHeader } from "./panel-header";

vi.mock("next-intl", () => ({
  useTranslations: (ns?: string) => (k: string) => (ns ? `${ns}.${k}` : k),
}));

vi.mock("@/stores/panel-store", () => ({
  usePanelStore: (selector: (s: { toggleAgentPanel: () => void }) => unknown) =>
    selector({ toggleAgentPanel: vi.fn() }),
}));

vi.mock("./thread-list", () => ({
  ThreadList: () => <div>threads</div>,
}));

describe("PanelHeader", () => {
  it("labels history and new conversation as visible actions", () => {
    render(<PanelHeader onNewThread={vi.fn()} />);

    for (const name of [
      "agentPanel.header.new_thread_aria",
      "agentPanel.header.thread_list_aria",
    ]) {
      const button = screen.getByRole("button", { name });
      expect(button.className).toContain("h-8");
      expect(button.className).toContain("px-2");
    }

    expect(screen.getByText("agentPanel.header.new_thread")).toBeInTheDocument();
    expect(screen.getByText("agentPanel.header.history")).toBeInTheDocument();

    const collapseButton = screen.getByRole("button", {
      name: "agentPanel.header.collapse_aria",
    });
    expect(collapseButton.className).toContain("h-8");
    expect(collapseButton.className).toContain("w-8");
  });
});
