import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ShellResizeHandle } from "./shell-resize-handle";

function dispatchMouseMove(clientX: number) {
  window.dispatchEvent(new MouseEvent("mousemove", { clientX, bubbles: true }));
}

function dispatchMouseUp() {
  window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
}

describe("ShellResizeHandle", () => {
  it("emits delta to onDrag during a drag", () => {
    const onDrag = vi.fn();
    const onReset = vi.fn();
    const { getByTestId } = render(
      <ShellResizeHandle onDrag={onDrag} onReset={onReset} />,
    );

    fireEvent.mouseDown(getByTestId("shell-resize-handle"), { clientX: 100 });
    dispatchMouseMove(110);
    expect(onDrag).toHaveBeenLastCalledWith(10);
    dispatchMouseMove(125);
    expect(onDrag).toHaveBeenLastCalledWith(15);
    dispatchMouseUp();
  });

  it("calls the latest onDrag prop after a re-render mid-drag", () => {
    // The original Phase 1 impl captured onDrag in useCallback's closure, so
    // the window-level mousemove listener (registered once on mousedown) kept
    // calling the very first onDrag forever. AppShell's onDrag closes over
    // the current panel width, so this stalled the resize at the first
    // delta. The ref-based fix should let mousemove call the latest onDrag.
    const onDragV1 = vi.fn();
    const onDragV2 = vi.fn();
    const onReset = vi.fn();

    const { getByTestId, rerender } = render(
      <ShellResizeHandle onDrag={onDragV1} onReset={onReset} />,
    );

    fireEvent.mouseDown(getByTestId("shell-resize-handle"), { clientX: 100 });
    dispatchMouseMove(110);
    expect(onDragV1).toHaveBeenLastCalledWith(10);

    rerender(<ShellResizeHandle onDrag={onDragV2} onReset={onReset} />);

    dispatchMouseMove(125);
    expect(onDragV2).toHaveBeenLastCalledWith(15);
    expect(onDragV1).toHaveBeenCalledTimes(1);
    dispatchMouseUp();
  });

  it("ignores mousemove before mousedown", () => {
    const onDrag = vi.fn();
    render(<ShellResizeHandle onDrag={onDrag} onReset={vi.fn()} />);
    dispatchMouseMove(50);
    expect(onDrag).not.toHaveBeenCalled();
  });

  it("stops emitting on mouseup", () => {
    const onDrag = vi.fn();
    const { getByTestId } = render(
      <ShellResizeHandle onDrag={onDrag} onReset={vi.fn()} />,
    );
    fireEvent.mouseDown(getByTestId("shell-resize-handle"), { clientX: 0 });
    dispatchMouseMove(10);
    dispatchMouseUp();
    onDrag.mockClear();
    dispatchMouseMove(20);
    expect(onDrag).not.toHaveBeenCalled();
  });

  it("removes window listeners on unmount", () => {
    const onDrag = vi.fn();
    const remove = vi.spyOn(window, "removeEventListener");
    const { getByTestId, unmount } = render(
      <ShellResizeHandle onDrag={onDrag} onReset={vi.fn()} />,
    );
    fireEvent.mouseDown(getByTestId("shell-resize-handle"), { clientX: 0 });
    unmount();
    const removed = remove.mock.calls
      .map((c) => c[0])
      .filter((name) => name === "mousemove" || name === "mouseup");
    expect(removed).toContain("mousemove");
    expect(removed).toContain("mouseup");
    remove.mockRestore();
  });

  it("invokes onReset on double click", () => {
    const onReset = vi.fn();
    const { getByTestId } = render(
      <ShellResizeHandle onDrag={vi.fn()} onReset={onReset} />,
    );
    fireEvent.doubleClick(getByTestId("shell-resize-handle"));
    expect(onReset).toHaveBeenCalledOnce();
  });
});
