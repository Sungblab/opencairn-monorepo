import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import koAgentPanel from "../../../messages/ko/agent-panel.json";
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
    expect(
      screen.queryByText("agentPanel.composer.modes.research_description"),
    ).not.toBeInTheDocument();
  });

  it("changes mode from the opened menu", () => {
    const onChange = vi.fn();
    render(<ModeSelector value="auto" onChange={onChange} />);

    fireEvent.click(
      screen.getByRole("button", {
        name: "agentPanel.composer.modes.trigger_aria",
      }),
    );
    fireEvent.click(
      screen.getByRole("menuitem", {
        name: /agentPanel\.composer\.modes\.accurate/,
      }),
    );

    expect(onChange).toHaveBeenCalledWith("accurate");
  });

  it("labels the trigger as the response mode control", () => {
    render(<ModeSelector value="auto" onChange={vi.fn()} />);

    const trigger = screen.getByRole("button", {
      name: "agentPanel.composer.modes.trigger_aria",
    });
    expect(trigger).toHaveTextContent(
      "agentPanel.composer.modes.trigger_label",
    );
    expect(trigger).toHaveTextContent("agentPanel.composer.modes.auto_short");
  });

  it("uses explicit Korean labels instead of raw enum tokens", () => {
    expect(koAgentPanel.composer.modes.auto).toBe("자동 선택");
    expect(koAgentPanel.composer.modes.auto_short).toBe("자동");
    expect(koAgentPanel.composer.modes.fast).toBe("빠른 답변");
    expect(koAgentPanel.composer.modes.accurate).toBe("정확");
    expect(koAgentPanel.composer.modes.auto_description).toContain("PDF");
    expect(koAgentPanel.composer.modes.fast).not.toBe("FAST");
  });
});
