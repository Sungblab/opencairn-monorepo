import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ModeSelector } from "./mode-selector";

vi.mock("next-intl", () => ({
  useTranslations: (ns?: string) => (k: string) => (ns ? `${ns}.${k}` : k),
}));

describe("ModeSelector", () => {
  it("uses a full-height trigger", () => {
    render(<ModeSelector value="auto" onChange={vi.fn()} />);

    const trigger = screen.getByRole("button", {
      name: "agentPanel.composer.modes.trigger_aria",
    });
    expect(trigger.className).toContain("min-h-7");
    expect(trigger).toHaveClass("rounded-[var(--radius-control)]");
  });

  it("explains each response mode inside the menu", () => {
    render(<ModeSelector value="auto" onChange={vi.fn()} />);

    fireEvent.click(
      screen.getByRole("button", {
        name: "agentPanel.composer.modes.trigger_aria",
      }),
    );

    expect(
      screen.getByText("agentPanel.composer.modes.auto_description"),
    ).toBeInTheDocument();
  });
});
