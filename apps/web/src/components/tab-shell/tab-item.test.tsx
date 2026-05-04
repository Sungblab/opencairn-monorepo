import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Tab } from "@/stores/tabs-store";
import { TabItem } from "./tab-item";

// Mock next-intl with a deterministic key passthrough so the suite doesn't
// need a NextIntlClientProvider. Matches the pattern used by other Phase 2
// component tests (see sidebar/*.test.tsx).
vi.mock("next-intl", () => ({
  useTranslations: (_ns?: string) => (key: string) => key,
}));

const mk = (p: Partial<Tab> = {}): Tab => ({
  id: "t1",
  kind: "note",
  targetId: "n1",
  mode: "plate",
  title: "My Note",
  pinned: false,
  preview: false,
  dirty: false,
  splitWith: null,
  splitSide: null,
  scrollY: 0,
  ...p,
});

describe("TabItem", () => {
  it("renders the tab title", () => {
    render(
      <TabItem tab={mk()} active={false} onClick={() => {}} onClose={() => {}} />,
    );
    expect(screen.getByText("My Note")).toBeInTheDocument();
  });

  it("marks the active tab with aria-selected=true", () => {
    render(
      <TabItem tab={mk()} active={true} onClick={() => {}} onClose={() => {}} />,
    );
    expect(screen.getByRole("tab").getAttribute("aria-selected")).toBe("true");
  });

  it("shows italic styling when preview=true", () => {
    render(
      <TabItem
        tab={mk({ preview: true })}
        active={false}
        onClick={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText("My Note").className).toMatch(/italic/);
  });

  it("shows a dirty dot with the unsaved label when dirty=true", () => {
    render(
      <TabItem
        tab={mk({ dirty: true })}
        active={false}
        onClick={() => {}}
        onClose={() => {}}
      />,
    );
    // useTranslations mock returns the key literally ⇒ label is "unsaved".
    expect(screen.getByLabelText("unsaved")).toBeInTheDocument();
  });

  it("swaps the close button for a pin icon when pinned=true", () => {
    render(
      <TabItem
        tab={mk({ pinned: true })}
        active={false}
        onClick={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByLabelText("pinned")).toBeInTheDocument();
    expect(screen.queryByLabelText("close")).toBeNull();
  });

  it("fires onClick on primary click", () => {
    const onClick = vi.fn();
    render(
      <TabItem
        tab={mk()}
        active={false}
        onClick={onClick}
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("tab"));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("fires onClose when the close button is clicked and stops propagation", () => {
    const onClick = vi.fn();
    const onClose = vi.fn();
    render(
      <TabItem
        tab={mk()}
        active={false}
        onClick={onClick}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByLabelText("close"));
    expect(onClose).toHaveBeenCalledOnce();
    // onClick is the tab-activation handler — clicking the close button
    // should NOT activate the tab or the user sees a flash before close.
    expect(onClick).not.toHaveBeenCalled();
  });

  it("uses a full-size close target", () => {
    render(
      <TabItem tab={mk()} active={false} onClick={() => {}} onClose={() => {}} />,
    );
    const close = screen.getByLabelText("close");
    expect(close.className).toContain("h-7");
    expect(close.className).toContain("w-7");
  });

  it("middle-click closes the tab (standard browser gesture)", () => {
    const onClose = vi.fn();
    render(
      <TabItem
        tab={mk()}
        active={false}
        onClick={() => {}}
        onClose={onClose}
      />,
    );
    fireEvent.mouseDown(screen.getByRole("tab"), { button: 1 });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("middle-click is a no-op on pinned tabs", () => {
    const onClose = vi.fn();
    render(
      <TabItem
        tab={mk({ pinned: true })}
        active={false}
        onClick={() => {}}
        onClose={onClose}
      />,
    );
    fireEvent.mouseDown(screen.getByRole("tab"), { button: 1 });
    expect(onClose).not.toHaveBeenCalled();
  });
});
