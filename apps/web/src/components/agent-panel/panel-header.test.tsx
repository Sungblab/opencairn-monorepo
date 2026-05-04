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
  it("uses full-size icon button targets", () => {
    render(<PanelHeader onNewThread={vi.fn()} />);

    for (const name of [
      "agentPanel.header.new_thread_aria",
      "agentPanel.header.thread_list_aria",
      "agentPanel.header.collapse_aria",
    ]) {
      const button = screen.getByRole("button", { name });
      expect(button.className).toContain("h-8");
      expect(button.className).toContain("w-8");
    }
  });
});
