import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAgentWorkbenchStore } from "@/stores/agent-workbench-store";
import { usePanelStore } from "@/stores/panel-store";
import { useTabsStore } from "@/stores/tabs-store";

import { SidebarFavorites } from "./sidebar-favorites";
import { sidebarFavoritesKey } from "./sidebar-favorites-store";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

vi.mock("next-intl", () => ({
  useTranslations: (ns?: string) => (key: string) =>
    ns ? `${ns}.${key}` : key,
}));

describe("SidebarFavorites", () => {
  beforeEach(() => {
    push.mockClear();
    window.localStorage.clear();
    useAgentWorkbenchStore.setState(
      useAgentWorkbenchStore.getInitialState(),
      true,
    );
    usePanelStore.setState(usePanelStore.getInitialState(), true);
    useTabsStore.setState(useTabsStore.getInitialState(), true);
  });

  it("opens a pinned note in the editor tab and scopes the agent panel to it", async () => {
    window.localStorage.setItem(
      sidebarFavoritesKey("acme"),
      JSON.stringify([
        {
          id: "tree-note-favorite",
          targetId: "note-favorite",
          label: "서비스 에이전트 문서",
          href: "/ko/workspace/acme/note/note-favorite",
          kind: "note",
        },
      ]),
    );

    render(<SidebarFavorites wsSlug="acme" />);

    expect(await screen.findByText("서비스 에이전트 문서")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: "sidebar.agent_actions.ask_ai",
      }),
    );

    expect(push).toHaveBeenCalledWith("/ko/workspace/acme/note/note-favorite");
    expect(useTabsStore.getState().tabs[0]).toMatchObject({
      kind: "note",
      targetId: "note-favorite",
      mode: "plate",
      title: "서비스 에이전트 문서",
    });
    expect(useAgentWorkbenchStore.getState().pendingIntent).toMatchObject({
      kind: "applyContext",
      commandId: "current_document_only",
    });
    expect(usePanelStore.getState()).toMatchObject({
      agentPanelOpen: true,
      agentPanelTab: "chat",
    });
  });
});
