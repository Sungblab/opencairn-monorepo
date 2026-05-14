import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TabContextMenuItems } from "./tab-context-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useTabsStore, type Tab } from "@/stores/tabs-store";

vi.mock("next-intl", () => ({
  useTranslations: (_ns?: string) => (key: string) => key,
  useLocale: () => "ko",
}));

const replace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/ko/workspace/acme/note/n1",
  useParams: () => ({ locale: "ko", wsSlug: "acme" }),
}));

// Base UI's MenuItem requires an enclosing MenuRoot context. We wrap in a
// real (but permanently open) ContextMenu so click handlers inside the
// items execute against the right provider. Content renders via Portal so
// the test queries document.body — testing-library's `screen` helpers do
// that by default.
function Harness({ children }: { children: React.ReactNode }) {
  return (
    <ContextMenu defaultOpen>
      <ContextMenuTrigger>anchor</ContextMenuTrigger>
      <ContextMenuContent>{children}</ContextMenuContent>
    </ContextMenu>
  );
}
const mk = (p: Partial<Tab> = {}): Tab => ({
  id: "t1",
  kind: "note",
  targetId: p.targetId ?? `n-${p.id ?? "t1"}`,
  mode: "plate",
  title: "Alpha",
  pinned: false,
  preview: false,
  dirty: false,
  splitWith: null,
  splitSide: null,
  scrollY: 0,
  ...p,
});

describe("TabContextMenuItems", () => {
  beforeEach(() => {
    localStorage.clear();
    useTabsStore.setState(useTabsStore.getInitialState(), true);
    useTabsStore.getState().setWorkspace("ws-ctx");
    replace.mockClear();
  });

  it("pin → togglePin flips pinned", () => {
    useTabsStore.getState().addTab(mk({ id: "a" }));
    render(
      <Harness>
        <TabContextMenuItems
          tab={mk({ id: "a", targetId: "n1" })}
          wsSlug="acme"
        />
      </Harness>,
    );
    fireEvent.click(screen.getByText("pin"));
    expect(useTabsStore.getState().tabs[0].pinned).toBe(true);
  });

  it("shows 'unpin' instead of 'pin' when the tab is already pinned", () => {
    render(
      <Harness>
        <TabContextMenuItems tab={mk({ pinned: true })} wsSlug="acme" />
      </Harness>,
    );
    expect(screen.getByText("unpin")).toBeInTheDocument();
    expect(screen.queryByText("pin")).toBeNull();
  });

  it("duplicate → addTab with preview=false, same kind + targetId", () => {
    useTabsStore.getState().addTab(mk({ id: "a", targetId: "n1" }));
    render(
      <Harness>
        <TabContextMenuItems
          tab={mk({ id: "a", targetId: "n1" })}
          wsSlug="acme"
        />
      </Harness>,
    );
    fireEvent.click(screen.getByText("duplicate"));
    const tabs = useTabsStore.getState().tabs;
    expect(tabs).toHaveLength(2);
    expect(tabs[1].targetId).toBe("n1");
    expect(tabs[1].preview).toBe(false);
    expect(tabs[1].id).not.toBe("a");
  });

  it("openToRight → opens a note tab in reading mode in the secondary split pane", () => {
    useTabsStore.getState().addTab(mk({ id: "a", targetId: "n1" }));
    render(
      <Harness>
        <TabContextMenuItems
          tab={mk({ id: "a", targetId: "n1" })}
          wsSlug="acme"
        />
      </Harness>,
    );

    fireEvent.click(screen.getByText("openToRight"));

    const state = useTabsStore.getState();
    expect(state.tabs).toHaveLength(2);
    expect(state.split).toMatchObject({
      primaryTabId: "a",
      secondaryTabId: state.tabs[1].id,
    });
    expect(state.tabs[1]).toMatchObject({
      kind: "note",
      targetId: "n1",
      mode: "reading",
      preview: false,
    });
  });

  it("openToRight reuses an already open tab with the same note target", () => {
    useTabsStore.getState().addTab(mk({ id: "a", targetId: "n1" }));
    useTabsStore
      .getState()
      .addTab(mk({ id: "existing", targetId: "n2", mode: "reading" }));
    useTabsStore.getState().setActive("a");
    render(
      <Harness>
        <TabContextMenuItems
          tab={mk({ id: "a", targetId: "n2" })}
          wsSlug="acme"
        />
      </Harness>,
    );

    fireEvent.click(screen.getByText("openToRight"));

    const state = useTabsStore.getState();
    expect(state.tabs.map((tab) => tab.id)).toEqual(["a", "existing"]);
    expect(state.split).toMatchObject({
      primaryTabId: "a",
      secondaryTabId: "existing",
    });
  });

  it("openBelow opens a note tab in reading mode in a horizontal split", () => {
    useTabsStore.getState().addTab(mk({ id: "a", targetId: "n1" }));
    render(
      <Harness>
        <TabContextMenuItems
          tab={mk({ id: "a", targetId: "n1" })}
          wsSlug="acme"
        />
      </Harness>,
    );

    fireEvent.click(screen.getByText("openBelow"));

    const state = useTabsStore.getState();
    expect(state.tabs).toHaveLength(2);
    expect(state.split).toMatchObject({
      primaryTabId: "a",
      secondaryTabId: state.tabs[1].id,
      orientation: "horizontal",
    });
    expect(state.tabs[1]).toMatchObject({
      kind: "note",
      targetId: "n1",
      mode: "reading",
      preview: false,
    });
  });

  it("close → closeTab removes the tab", () => {
    useTabsStore.getState().addTab(mk({ id: "a" }));
    useTabsStore.getState().addTab(mk({ id: "b" }));
    render(
      <Harness>
        <TabContextMenuItems tab={mk({ id: "a" })} wsSlug="acme" />
      </Harness>,
    );
    fireEvent.click(screen.getByText("close"));
    expect(useTabsStore.getState().tabs.map((t) => t.id)).toEqual(["b"]);
  });

  it("close on the active tab routes to the next active tab", () => {
    useTabsStore.getState().addTab(mk({ id: "a", targetId: "n1" }));
    useTabsStore.getState().addTab(mk({ id: "b", targetId: "n2" }));
    useTabsStore.getState().setActive("a");
    render(
      <Harness>
        <TabContextMenuItems
          tab={mk({ id: "a", targetId: "n1" })}
          wsSlug="acme"
        />
      </Harness>,
    );
    fireEvent.click(screen.getByText("close"));
    expect(replace).toHaveBeenCalledWith("/ko/workspace/acme/note/n2");
  });

  it("close is disabled for pinned tabs", () => {
    render(
      <Harness>
        <TabContextMenuItems tab={mk({ pinned: true })} wsSlug="acme" />
      </Harness>,
    );
    const closeItem = screen.getByText("close").closest("[role='menuitem']");
    expect(closeItem?.getAttribute("data-disabled")).not.toBeNull();
  });

  it("closeOthers → closeOthers removes non-pinned peers", () => {
    ["a", "b", "c"].forEach((id) =>
      useTabsStore.getState().addTab(mk({ id })),
    );
    render(
      <Harness>
        <TabContextMenuItems tab={mk({ id: "b" })} wsSlug="acme" />
      </Harness>,
    );
    fireEvent.click(screen.getByText("closeOthers"));
    expect(useTabsStore.getState().tabs.map((t) => t.id)).toEqual(["b"]);
  });

  it("closeRight → closeRight trims right neighbors", () => {
    ["a", "b", "c", "d"].forEach((id) =>
      useTabsStore.getState().addTab(mk({ id })),
    );
    render(
      <Harness>
        <TabContextMenuItems tab={mk({ id: "b" })} wsSlug="acme" />
      </Harness>,
    );
    fireEvent.click(screen.getByText("closeRight"));
    expect(useTabsStore.getState().tabs.map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("copyLink writes the absolute URL to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(
      <Harness>
        <TabContextMenuItems
          tab={mk({ kind: "note", targetId: "n-42" })}
          wsSlug="acme"
        />
      </Harness>,
    );
    fireEvent.click(screen.getByText("copyLink"));
    expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}/ko/workspace/acme/note/n-42`,
    );
  });
});
