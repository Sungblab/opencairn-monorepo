import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { ColumnResizeHandle } from "./column-resize-handle";
import koMessages from "@/../messages/ko/editor.json";

function withIntl(ui: React.ReactNode) {
  return (
    <NextIntlClientProvider locale="ko" messages={{ editor: koMessages }}>
      {ui}
    </NextIntlClientProvider>
  );
}

describe("ColumnResizeHandle", () => {
  it("renders with role=separator and aria-valuemin/max", () => {
    const { container } = render(
      withIntl(
        <ColumnResizeHandle
          leftWidthPct={50}
          onResize={vi.fn()}
          onCommit={vi.fn()}
          onReset={vi.fn()}
        />,
      ),
    );
    const sep = container.querySelector("[role=separator]")!;
    expect(sep.getAttribute("aria-valuemin")).toBe("10");
    expect(sep.getAttribute("aria-valuemax")).toBe("90");
    expect(sep.getAttribute("aria-valuenow")).toBe("50");
  });

  it("calls onCommit on pointerup with delta percentage", () => {
    const onResize = vi.fn();
    const onCommit = vi.fn();
    const { container } = render(
      withIntl(
        <ColumnResizeHandle
          leftWidthPct={50}
          onResize={onResize}
          onCommit={onCommit}
          onReset={vi.fn()}
        />,
      ),
    );
    const sep = container.querySelector("[role=separator]")! as HTMLElement;
    // Mock the parent rect so dragging by 100px in a 1000px-wide group = 10%
    Object.defineProperty(sep.parentElement!, "getBoundingClientRect", {
      value: () => ({ left: 0, right: 1000, width: 1000 } as DOMRect),
    });
    fireEvent.pointerDown(sep, { pointerId: 1, clientX: 500 });
    fireEvent.pointerMove(sep, { pointerId: 1, clientX: 600 });
    fireEvent.pointerUp(sep, { pointerId: 1, clientX: 600 });
    expect(onCommit).toHaveBeenCalledWith(60); // 600/1000 * 100
  });

  it("calls onReset on double-click", () => {
    const onReset = vi.fn();
    const { container } = render(
      withIntl(
        <ColumnResizeHandle
          leftWidthPct={70}
          onResize={vi.fn()}
          onCommit={vi.fn()}
          onReset={onReset}
        />,
      ),
    );
    const sep = container.querySelector("[role=separator]")! as HTMLElement;
    fireEvent.doubleClick(sep);
    expect(onReset).toHaveBeenCalled();
  });

  it("ArrowLeft shrinks left by 5", () => {
    const onCommit = vi.fn();
    const { container } = render(
      withIntl(
        <ColumnResizeHandle
          leftWidthPct={50}
          onResize={vi.fn()}
          onCommit={onCommit}
          onReset={vi.fn()}
        />,
      ),
    );
    const sep = container.querySelector("[role=separator]")! as HTMLElement;
    sep.focus();
    fireEvent.keyDown(sep, { key: "ArrowLeft" });
    expect(onCommit).toHaveBeenCalledWith(45);
  });

  it("Shift+ArrowRight grows left by 1", () => {
    const onCommit = vi.fn();
    const { container } = render(
      withIntl(
        <ColumnResizeHandle
          leftWidthPct={50}
          onResize={vi.fn()}
          onCommit={onCommit}
          onReset={vi.fn()}
        />,
      ),
    );
    const sep = container.querySelector("[role=separator]")! as HTMLElement;
    sep.focus();
    fireEvent.keyDown(sep, { key: "ArrowRight", shiftKey: true });
    expect(onCommit).toHaveBeenCalledWith(51);
  });
});
