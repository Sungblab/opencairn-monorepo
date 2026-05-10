import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePanelStore } from "@/stores/panel-store";
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
  });

  it("opens the right workbench activity tab instead of navigating away", async () => {
    usePanelStore.getState().setAgentPanelOpen(false);

    render(<GenerateDocumentButton wsSlug="acme" projectId="p1" />);

    await userEvent.click(
      screen.getByRole("button", { name: "sidebar.nav.generate_document" }),
    );

    expect(usePanelStore.getState().agentPanelOpen).toBe(true);
    expect(usePanelStore.getState().compactAgentPanelOpen).toBe(true);
    expect(usePanelStore.getState().agentPanelTab).toBe("activity");
  });
});
