import { beforeEach, describe, expect, it } from "vitest";
import { useSidebarStore } from "./sidebar-store";

describe("sidebar-store", () => {
  beforeEach(() => {
    localStorage.clear();
    useSidebarStore.setState(useSidebarStore.getInitialState(), true);
  });

  it("toggleExpanded adds and removes ids", () => {
    useSidebarStore.getState().setWorkspace("ws-a");
    useSidebarStore.getState().toggleExpanded("folder-1");
    expect(useSidebarStore.getState().isExpanded("folder-1")).toBe(true);
    useSidebarStore.getState().toggleExpanded("folder-1");
    expect(useSidebarStore.getState().isExpanded("folder-1")).toBe(false);
  });

  it("persists expanded set across workspace reload", () => {
    useSidebarStore.getState().setWorkspace("ws-a");
    useSidebarStore.getState().toggleExpanded("folder-1");
    useSidebarStore.getState().setWorkspace("ws-b");
    useSidebarStore.getState().setWorkspace("ws-a");
    expect(useSidebarStore.getState().isExpanded("folder-1")).toBe(true);
  });

  it("workspace switch isolates expanded sets", () => {
    useSidebarStore.getState().setWorkspace("ws-a");
    useSidebarStore.getState().toggleExpanded("a-1");
    useSidebarStore.getState().setWorkspace("ws-b");
    expect(useSidebarStore.getState().isExpanded("a-1")).toBe(false);
  });

  it("persists collapsed sections per workspace", () => {
    useSidebarStore.getState().setWorkspace("ws-a");
    useSidebarStore.getState().toggleSectionCollapsed("service_agent");
    expect(useSidebarStore.getState().isSectionCollapsed("service_agent")).toBe(
      true,
    );

    useSidebarStore.getState().setWorkspace("ws-b");
    expect(useSidebarStore.getState().isSectionCollapsed("service_agent")).toBe(
      false,
    );

    useSidebarStore.getState().setWorkspace("ws-a");
    expect(useSidebarStore.getState().isSectionCollapsed("service_agent")).toBe(
      true,
    );
  });

  it("starts with lower-priority sections collapsed by default", () => {
    useSidebarStore.getState().setWorkspace("ws-a");

    expect(useSidebarStore.getState().isSectionCollapsed("favorites")).toBe(
      true,
    );
    expect(useSidebarStore.getState().isSectionCollapsed("recent")).toBe(true);
    expect(useSidebarStore.getState().isSectionCollapsed("project_tools")).toBe(
      false,
    );
    expect(useSidebarStore.getState().isSectionCollapsed("files")).toBe(false);
  });

  it("moves used quick-create actions to the front and persists the order", () => {
    useSidebarStore.getState().setWorkspace("ws-a");

    useSidebarStore.getState().recordQuickCreateUse("generate_document");

    expect(useSidebarStore.getState().quickCreateOrder[0]).toBe(
      "generate_document",
    );

    useSidebarStore.getState().setWorkspace("ws-b");
    expect(useSidebarStore.getState().quickCreateOrder[0]).toBe("new_note");

    useSidebarStore.getState().setWorkspace("ws-a");
    expect(useSidebarStore.getState().quickCreateOrder[0]).toBe(
      "generate_document",
    );
  });
});
