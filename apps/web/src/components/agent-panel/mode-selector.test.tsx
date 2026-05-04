import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ModeSelector } from "./mode-selector";

vi.mock("next-intl", () => ({
  useTranslations: (ns?: string) => (k: string) => (ns ? `${ns}.${k}` : k),
}));

describe("ModeSelector", () => {
  it("uses a full-height trigger", () => {
    render(<ModeSelector value="auto" onChange={vi.fn()} />);

    expect(
      screen.getByRole("button", {
        name: "agentPanel.composer.modes.trigger_aria",
      }).className,
    ).toContain("min-h-7");
  });
});
