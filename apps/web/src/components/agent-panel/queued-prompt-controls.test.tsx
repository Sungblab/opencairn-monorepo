import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { QueuedPromptControls } from "./queued-prompt-controls";

vi.mock("next-intl", () => ({
  useTranslations: (ns?: string) => (k: string) => (ns ? `${ns}.${k}` : k),
}));

describe("QueuedPromptControls", () => {
  it("lets the queued prompt be edited or discarded", () => {
    const onChange = vi.fn();
    const onDiscard = vi.fn();
    const onInterrupt = vi.fn();

    render(
      <QueuedPromptControls
        content="queued prompt"
        onChange={onChange}
        onDiscard={onDiscard}
        onInterrupt={onInterrupt}
      />,
    );

    expect(screen.getByText("agentPanel.queuedPrompt.label")).toBeInTheDocument();
    fireEvent.change(
      screen.getByLabelText("agentPanel.queuedPrompt.edit_aria"),
      { target: { value: "edited prompt" } },
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "agentPanel.queuedPrompt.delete_aria",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "agentPanel.queuedPrompt.interrupt_aria",
      }),
    );

    expect(onChange).toHaveBeenCalledWith("edited prompt");
    expect(onDiscard).toHaveBeenCalled();
    expect(onInterrupt).toHaveBeenCalled();
  });
});
