import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Composer } from "./composer";

// Mirror the next-intl shim used elsewhere in the suite (see
// sidebar-footer.test.tsx). Returning `${ns}.${key}` keeps assertions
// stable across locale swaps and avoids pulling in the real provider.
vi.mock("next-intl", () => ({
  useTranslations: (ns?: string) => (k: string) => (ns ? `${ns}.${k}` : k),
}));

const PLACEHOLDER = "agentPanel.composer.placeholder";
const INPUT_LABEL = "agentPanel.composer.input_aria";
const VOICE_LABEL = "agentPanel.composer.voice_aria";
const SEND_LABEL = "agentPanel.composer.send_aria";

describe("Composer", () => {
  it("labels the message textarea for assistive technology", () => {
    render(<Composer onSend={vi.fn()} />);
    expect(screen.getByLabelText(INPUT_LABEL)).toBeInTheDocument();
  });

  it("keeps the textarea at a usable desktop click height", () => {
    render(<Composer onSend={vi.fn()} />);
    expect(screen.getByLabelText(INPUT_LABEL)).toHaveClass("min-h-14");
  });

  it("shows mic when empty, send when non-empty", () => {
    const onSend = vi.fn();
    render(<Composer onSend={onSend} />);
    expect(screen.getByLabelText(VOICE_LABEL)).toBeInTheDocument();
    expect(screen.queryByLabelText(SEND_LABEL)).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(PLACEHOLDER), {
      target: { value: "hi" },
    });

    expect(screen.getByLabelText(SEND_LABEL)).toBeInTheDocument();
    expect(screen.queryByLabelText(VOICE_LABEL)).not.toBeInTheDocument();
  });

  it("Enter submits with the current mode", () => {
    const onSend = vi.fn();
    render(<Composer onSend={onSend} />);
    const ta = screen.getByPlaceholderText(PLACEHOLDER);
    fireEvent.change(ta, { target: { value: "hi" } });
    fireEvent.keyDown(ta, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith({ content: "hi", mode: "auto" });
  });

  it("Shift+Enter does not submit", () => {
    const onSend = vi.fn();
    render(<Composer onSend={onSend} />);
    const ta = screen.getByPlaceholderText(PLACEHOLDER);
    fireEvent.change(ta, { target: { value: "hi" } });
    fireEvent.keyDown(ta, { key: "Enter", shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("trims whitespace before sending and ignores blank input", () => {
    const onSend = vi.fn();
    render(<Composer onSend={onSend} />);
    const ta = screen.getByPlaceholderText(PLACEHOLDER);

    fireEvent.change(ta, { target: { value: "   " } });
    fireEvent.keyDown(ta, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.change(ta, { target: { value: "  hello  " } });
    fireEvent.keyDown(ta, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith({ content: "hello", mode: "auto" });
  });

  it("clears the textarea after a successful send", () => {
    const onSend = vi.fn();
    render(<Composer onSend={onSend} />);
    const ta = screen.getByPlaceholderText(PLACEHOLDER) as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "hi" } });
    fireEvent.keyDown(ta, { key: "Enter" });
    expect(ta.value).toBe("");
    // Empty input → mic returns, send disappears.
    expect(screen.getByLabelText(VOICE_LABEL)).toBeInTheDocument();
  });

  it("respects the disabled prop (no submit on Enter)", () => {
    const onSend = vi.fn();
    render(<Composer onSend={onSend} disabled />);
    const ta = screen.getByPlaceholderText(PLACEHOLDER);
    fireEvent.change(ta, { target: { value: "hi" } });
    fireEvent.keyDown(ta, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
  });
});
