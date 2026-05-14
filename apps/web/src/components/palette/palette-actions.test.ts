// @vitest-environment jsdom

import { describe, expect, it, beforeEach } from "vitest";
import { buildActions } from "./palette-actions";
import { useTabsStore } from "@/stores/tabs-store";

describe("palette actions", () => {
  beforeEach(() => {
    useTabsStore.setState(
      {
        workspaceId: "ws",
        version: 1,
        tabs: [],
        activeId: null,
        activePane: "primary",
        split: null,
        closedStack: [],
        recentlyActiveTabIds: [],
      },
      false,
    );
  });

  it("opens the Agent Panel as a routed workspace tab", () => {
    const action = buildActions({ locale: "ko", wsSlug: "acme" }).find(
      (candidate) => candidate.id === "open-agent-tab",
    );

    expect(action).toBeDefined();
    action!.run({ push: () => undefined } as never);

    expect(useTabsStore.getState().tabs).toEqual([
      expect.objectContaining({
        kind: "agent_panel",
        targetId: null,
        mode: "agent-panel",
        titleKey: "appShell.tabTitles.agent_panel",
        preview: false,
      }),
    ]);
  });

  it("does not expose shell-only Agent Panel actions outside a workspace", () => {
    expect(
      buildActions({ locale: "ko" }).some(
        (candidate) => candidate.id === "open-agent-tab",
      ),
    ).toBe(false);
  });
});
