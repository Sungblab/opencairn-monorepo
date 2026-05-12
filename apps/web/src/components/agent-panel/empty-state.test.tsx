import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AgentPanelEmptyState } from "./empty-state";

vi.mock("next-intl", () => ({
  useTranslations: (ns?: string) => (k: string) => (ns ? `${ns}.${k}` : k),
}));

describe("AgentPanelEmptyState", () => {
  it("shows context-aware starter suggestions", () => {
    render(<AgentPanelEmptyState hasContext />);

    expect(
      screen.getByText("agentPanel.empty_state.title_with_context"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "agentPanel.empty_state.suggestions.summarize.label",
      }),
    ).toBeInTheDocument();
  });

  it("submits the matching starter prompt", () => {
    const onSuggestion = vi.fn();
    render(<AgentPanelEmptyState onSuggestion={onSuggestion} />);

    fireEvent.click(
      screen.getByRole("button", {
        name: "agentPanel.empty_state.suggestions.questions.label",
      }),
    );

    expect(onSuggestion).toHaveBeenCalledWith(
      "agentPanel.empty_state.suggestions.questions.prompt",
    );
  });
});
