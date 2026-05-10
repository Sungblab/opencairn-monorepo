// Plan 2E Phase B-4 Task 4.5 — Math edit popover unit tests.
//
// Tests the standalone MathEditPopover component (textarea + KaTeX preview).
// Uses jsdom environment (tsx file), no editor required.

import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { MathEditPopover } from "./math-edit-popover";
import koMessages from "@/../messages/ko/editor.json";

function withIntl(ui: React.ReactNode) {
  return (
    <NextIntlClientProvider locale="ko" messages={{ editor: koMessages }}>
      {ui}
    </NextIntlClientProvider>
  );
}

describe("MathEditPopover", () => {
  it("renders KaTeX preview for valid LaTeX", async () => {
    render(
      withIntl(
        <MathEditPopover
          open
          onOpenChange={vi.fn()}
          initialTex="x^2"
          onSave={vi.fn()}
          onDelete={vi.fn()}
          anchor={<span>anchor</span>}
        />,
      ),
    );
    // PopoverContent renders into a Portal (document.body), not the render container.
    // KaTeX injects elements with the .katex class into the preview pane.
    await waitFor(() => {
      expect(document.body.querySelector(".katex")).toBeTruthy();
    });
  });

  it("calls onSave with new tex on Save click", () => {
    const onSave = vi.fn();
    const { getByPlaceholderText, getByText } = render(
      withIntl(
        <MathEditPopover
          open
          onOpenChange={vi.fn()}
          initialTex="x^2"
          onSave={onSave}
          onDelete={vi.fn()}
          anchor={<span>anchor</span>}
        />,
      ),
    );
    const ta = getByPlaceholderText(koMessages.math.editPopover.placeholder);
    fireEvent.change(ta, { target: { value: "y^3" } });
    fireEvent.click(getByText(koMessages.math.editPopover.save));
    expect(onSave).toHaveBeenCalledWith("y^3");
  });

  it("calls onDelete when saving with empty content", () => {
    const onSave = vi.fn();
    const onDelete = vi.fn();
    const { getByPlaceholderText, getByText } = render(
      withIntl(
        <MathEditPopover
          open
          onOpenChange={vi.fn()}
          initialTex="x^2"
          onSave={onSave}
          onDelete={onDelete}
          anchor={<span>anchor</span>}
        />,
      ),
    );
    fireEvent.change(
      getByPlaceholderText(koMessages.math.editPopover.placeholder),
      { target: { value: "" } },
    );
    fireEvent.click(getByText(koMessages.math.editPopover.save));
    expect(onSave).not.toHaveBeenCalled();
    expect(onDelete).toHaveBeenCalled();
  });
});
