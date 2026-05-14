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
    expect(s.agentPanelOpen).toBe(false);
    expect(s.compactAgentPanelOpen).toBe(false);
    expect(s.agentPanelTab).toBe("chat");
    expect(s.bottomDockOpen).toBe(false);
    expect(s.bottomDockHeight).toBe(260);
    expect(s.bottomDockTab).toBe("activity");
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

  it("starts from SSR-safe defaults before hydrating persisted panel state", () => {
    localStorage.setItem(
      "oc:panel",
      JSON.stringify({
        state: {
          sidebarWidth: 271,
          sidebarOpen: true,
          agentPanelWidth: 420,
          agentPanelOpen: true,
          agentPanelTab: "notifications",
          bottomDockOpen: true,
          bottomDockHeight: 390,
          bottomDockTab: "logs",
          backlinksOpen: true,
          enrichmentOpen: false,
        },
      }),
    );
    usePanelStore.setState(usePanelStore.getInitialState(), true);

    expect(usePanelStore.getState()).toMatchObject({
      sidebarWidth: 240,
      agentPanelWidth: 360,
      agentPanelOpen: false,
      agentPanelTab: "chat",
    });

    usePanelStore.getState().hydrateFromStorage();

    expect(usePanelStore.getState()).toMatchObject({
      sidebarWidth: 271,
      agentPanelWidth: 420,
      agentPanelOpen: true,
      agentPanelTab: "notifications",
      bottomDockOpen: true,
      bottomDockHeight: 390,
      bottomDockTab: "logs",
      backlinksOpen: true,
    });
  });

  it("resetSidebarWidth restores 240", () => {
    usePanelStore.getState().setSidebarWidth(380);
    usePanelStore.getState().resetSidebarWidth();
    expect(usePanelStore.getState().sidebarWidth).toBe(240);
  });

  it("toggleAgentPanel flips agentPanelOpen", () => {
    usePanelStore.getState().toggleAgentPanel();
    expect(usePanelStore.getState().agentPanelOpen).toBe(true);
  });

  it("setAgentPanelOpen assigns an explicit open state", () => {
    usePanelStore.getState().setAgentPanelOpen(false);
    expect(usePanelStore.getState().agentPanelOpen).toBe(false);
    usePanelStore.getState().setAgentPanelOpen(true);
    expect(usePanelStore.getState().agentPanelOpen).toBe(true);
  });

  it("opens the agent panel on the requested tab", () => {
    usePanelStore.getState().setAgentPanelOpen(false);
    usePanelStore.getState().openAgentPanelTab("notifications");

    expect(usePanelStore.getState().agentPanelOpen).toBe(true);
    expect(usePanelStore.getState().compactAgentPanelOpen).toBe(true);
    expect(usePanelStore.getState().agentPanelTab).toBe("notifications");
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

  it("opens and sizes the bottom dock independently from the agent panel", () => {
    usePanelStore.getState().openBottomDock("logs");
    expect(usePanelStore.getState()).toMatchObject({
      bottomDockOpen: true,
      bottomDockTab: "logs",
      agentPanelOpen: false,
    });

    usePanelStore.getState().setBottomDockHeight(50);
    expect(usePanelStore.getState().bottomDockHeight).toBe(180);
    usePanelStore.getState().setBottomDockHeight(999);
    expect(usePanelStore.getState().bottomDockHeight).toBe(420);
    usePanelStore.getState().resetBottomDockHeight();
    expect(usePanelStore.getState().bottomDockHeight).toBe(260);
  });
});
