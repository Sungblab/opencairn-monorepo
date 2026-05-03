import { beforeEach, describe, expect, it } from "vitest";
import { usePanelStore } from "./panel-store";

function reset() {
  localStorage.clear();
  usePanelStore.setState(usePanelStore.getInitialState(), true);
}

describe("panel-store", () => {
  beforeEach(reset);

  it("has default widths and open states", () => {
    const s = usePanelStore.getState();
    expect(s.sidebarWidth).toBe(240);
    expect(s.sidebarOpen).toBe(true);
    expect(s.compactSidebarOpen).toBe(false);
    expect(s.agentPanelWidth).toBe(360);
    expect(s.agentPanelOpen).toBe(true);
    expect(s.compactAgentPanelOpen).toBe(false);
  });

  it("toggleSidebar flips sidebarOpen", () => {
    usePanelStore.getState().toggleSidebar();
    expect(usePanelStore.getState().sidebarOpen).toBe(false);
    usePanelStore.getState().toggleSidebar();
    expect(usePanelStore.getState().sidebarOpen).toBe(true);
  });

  it("setSidebarOpen assigns an explicit open state", () => {
    usePanelStore.getState().setSidebarOpen(false);
    expect(usePanelStore.getState().sidebarOpen).toBe(false);
    usePanelStore.getState().setSidebarOpen(true);
    expect(usePanelStore.getState().sidebarOpen).toBe(true);
  });

  it("compact sidebar state does not mutate the desktop preference", () => {
    usePanelStore.getState().setSidebarOpen(true);
    usePanelStore.getState().setCompactSidebarOpen(true);
    expect(usePanelStore.getState().sidebarOpen).toBe(true);
    expect(usePanelStore.getState().compactSidebarOpen).toBe(true);
    usePanelStore.getState().toggleCompactSidebar();
    expect(usePanelStore.getState().sidebarOpen).toBe(true);
    expect(usePanelStore.getState().compactSidebarOpen).toBe(false);
  });

  it("setSidebarWidth clamps to [180,400]", () => {
    usePanelStore.getState().setSidebarWidth(50);
    expect(usePanelStore.getState().sidebarWidth).toBe(180);
    usePanelStore.getState().setSidebarWidth(500);
    expect(usePanelStore.getState().sidebarWidth).toBe(400);
    usePanelStore.getState().setSidebarWidth(300);
    expect(usePanelStore.getState().sidebarWidth).toBe(300);
  });

  it("setAgentPanelWidth clamps to [300,560]", () => {
    usePanelStore.getState().setAgentPanelWidth(200);
    expect(usePanelStore.getState().agentPanelWidth).toBe(300);
    usePanelStore.getState().setAgentPanelWidth(999);
    expect(usePanelStore.getState().agentPanelWidth).toBe(560);
  });

  it("persists sidebarWidth across store recreation via localStorage", () => {
    usePanelStore.getState().setSidebarWidth(320);
    expect(localStorage.getItem("oc:panel")).toContain("320");
  });

  it("resetSidebarWidth restores 240", () => {
    usePanelStore.getState().setSidebarWidth(380);
    usePanelStore.getState().resetSidebarWidth();
    expect(usePanelStore.getState().sidebarWidth).toBe(240);
  });

  it("toggleAgentPanel flips agentPanelOpen", () => {
    usePanelStore.getState().toggleAgentPanel();
    expect(usePanelStore.getState().agentPanelOpen).toBe(false);
  });

  it("setAgentPanelOpen assigns an explicit open state", () => {
    usePanelStore.getState().setAgentPanelOpen(false);
    expect(usePanelStore.getState().agentPanelOpen).toBe(false);
    usePanelStore.getState().setAgentPanelOpen(true);
    expect(usePanelStore.getState().agentPanelOpen).toBe(true);
  });

  it("compact agent panel state does not mutate the desktop preference", () => {
    usePanelStore.getState().setAgentPanelOpen(true);
    usePanelStore.getState().setCompactAgentPanelOpen(true);
    expect(usePanelStore.getState().agentPanelOpen).toBe(true);
    expect(usePanelStore.getState().compactAgentPanelOpen).toBe(true);
    usePanelStore.getState().toggleCompactAgentPanel();
    expect(usePanelStore.getState().agentPanelOpen).toBe(true);
    expect(usePanelStore.getState().compactAgentPanelOpen).toBe(false);
  });

  it("resetAgentPanelWidth restores 360", () => {
    usePanelStore.getState().setAgentPanelWidth(500);
    usePanelStore.getState().resetAgentPanelWidth();
    expect(usePanelStore.getState().agentPanelWidth).toBe(360);
  });
});
