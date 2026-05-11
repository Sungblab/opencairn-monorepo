import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Tab } from "@/stores/tabs-store";
import { TestShellLabelsProvider } from "@/components/shell/shell-labels.test-utils";
import { TabItem } from "./tab-item";

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

const renderTabItem = (tab: Tab, active = false, onClick = () => {}, onClose = () => {}) =>
  render(
    <TestShellLabelsProvider>
      <TabItem
        tab={tab}
        active={active}
        onClick={onClick}
        onClose={onClose}
      />
    </TestShellLabelsProvider>,
  );

describe("TabItem", () => {
  it("renders the tab title", () => {
    renderTabItem(mk());
    expect(screen.getByText("My Note")).toBeInTheDocument();
  });

  it("marks the active tab with aria-selected=true", () => {
    renderTabItem(mk(), true);
    expect(screen.getByRole("tab").getAttribute("aria-selected")).toBe("true");
  });

  it("shows italic styling when preview=true", () => {
    renderTabItem(mk({ preview: true }));
    expect(screen.getByText("My Note").className).toMatch(/italic/);
  });

  it("shows a dirty dot with the unsaved label when dirty=true", () => {
    renderTabItem(mk({ dirty: true }));
    expect(screen.getByLabelText("unsaved")).toBeInTheDocument();
  });

  it("swaps the close button for a pin icon when pinned=true", () => {
    renderTabItem(mk({ pinned: true }));
    expect(screen.getByLabelText("pinned")).toBeInTheDocument();
    expect(screen.queryByLabelText("close")).toBeNull();
  });

  it("fires onClick on primary click", () => {
    const onClick = vi.fn();
    renderTabItem(mk(), false, onClick);
    fireEvent.click(screen.getByRole("tab"));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("fires onClose when the close button is clicked and stops propagation", () => {
    const onClick = vi.fn();
    const onClose = vi.fn();
    renderTabItem(mk(), false, onClick, onClose);
    fireEvent.click(screen.getByLabelText("close"));
    expect(onClose).toHaveBeenCalledOnce();
    // onClick is the tab-activation handler — clicking the close button
    // should NOT activate the tab or the user sees a flash before close.
    expect(onClick).not.toHaveBeenCalled();
  });

  it("uses a full-size close target", () => {
    renderTabItem(mk());
    const close = screen.getByLabelText("close");
    expect(close.className).toContain("h-7");
    expect(close.className).toContain("w-7");
  });

  it("keeps inactive tabs compact and low contrast", () => {
    renderTabItem(mk());
    const tab = screen.getByRole("tab");

    expect(tab.className).toContain("min-w-[104px]");
    expect(tab.className).toContain("max-w-[200px]");
    expect(tab.className).toContain("border-border/70");
  });

  it("middle-click closes the tab (standard browser gesture)", () => {
    const onClose = vi.fn();
    renderTabItem(mk(), false, () => {}, onClose);
    fireEvent.mouseDown(screen.getByRole("tab"), { button: 1 });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("middle-click is a no-op on pinned tabs", () => {
    const onClose = vi.fn();
    renderTabItem(mk({ pinned: true }), false, () => {}, onClose);
    fireEvent.mouseDown(screen.getByRole("tab"), { button: 1 });
    expect(onClose).not.toHaveBeenCalled();
  });
});
