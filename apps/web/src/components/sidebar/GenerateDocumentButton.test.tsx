import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePanelStore } from "@/stores/panel-store";
import { useAgentWorkbenchStore } from "@/stores/agent-workbench-store";
import { GenerateDocumentButton } from "./GenerateDocumentButton";

vi.mock("next-intl", () => ({
  useLocale: () => "ko",
  useTranslations: (ns?: string) => (key: string) =>
    ns ? `${ns}.${key}` : key,
}));

describe("GenerateDocumentButton", () => {
  beforeEach(() => {
    localStorage.clear();
    usePanelStore.setState(usePanelStore.getInitialState(), true);
    useAgentWorkbenchStore.setState(useAgentWorkbenchStore.getInitialState(), true);
  });

  it("opens a document workflow in agent chat instead of the activity tab", async () => {
    usePanelStore.getState().setAgentPanelOpen(false);

    render(<GenerateDocumentButton wsSlug="acme" projectId="p1" />);

    await userEvent.click(
      screen.getByRole("button", { name: "sidebar.nav.generate_document" }),
    );

    expect(usePanelStore.getState().agentPanelOpen).toBe(true);
    expect(usePanelStore.getState().compactAgentPanelOpen).toBe(true);
    expect(usePanelStore.getState().agentPanelTab).toBe("chat");
    expect(useAgentWorkbenchStore.getState().pendingWorkflow).toMatchObject({
      kind: "document_generation",
      toolId: "pdf_report_fast",
      presetId: "pdf_report_fast",
    });
  });
});
