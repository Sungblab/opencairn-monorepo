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
});
