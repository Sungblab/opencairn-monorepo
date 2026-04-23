import { renderHook, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useUrlTabSync } from "./use-url-tab-sync";
import { useTabsStore, type Tab } from "@/stores/tabs-store";

const push = vi.fn();
const replace = vi.fn();
// Mutable path lets a single test simulate a URL change between renders —
// usePathname returns whatever `currentPath` is at call time, and
// `renderHook`'s rerender triggers the effect that reads it.
let currentPath = "/w/acme/n/n-1";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
  usePathname: () => currentPath,
  useParams: () => ({ wsSlug: "acme" }),
}));

// Stub next-intl's useTranslations so the hook can resolve placeholder tab
// titles without a NextIntlClientProvider wrapper. Real i18n is exercised
// by the Playwright spec; the unit test only needs deterministic output.
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) =>
    vars && "id" in vars ? `${key}:${vars.id}` : key,
}));

describe("useUrlTabSync", () => {
  beforeEach(() => {
    localStorage.clear();
    useTabsStore.setState(useTabsStore.getInitialState(), true);
    push.mockClear();
    replace.mockClear();
    currentPath = "/w/acme/n/n-1";
  });

  it("creates a tab matching the current URL on mount", () => {
    renderHook(() => useUrlTabSync());
    const s = useTabsStore.getState();
    expect(s.tabs).toHaveLength(1);
    expect(s.tabs[0]).toMatchObject({ kind: "note", targetId: "n-1" });
    expect(s.activeId).toBe(s.tabs[0].id);
  });

  it("activates existing matching tab instead of creating a new one", () => {
    const existing: Tab = {
      id: "pre",
      kind: "note",
      targetId: "n-1",
      mode: "plate",
      title: "existing",
      pinned: false,
      preview: false,
      dirty: false,
      splitWith: null,
      splitSide: null,
      scrollY: 0,
    };
    // Pre-seed localStorage under the same key the hook derives ("ws_slug:acme")
    // so the setWorkspace effect loads this tab into the store before the URL
    // sync effect tries to add a duplicate.
    localStorage.setItem(
      "oc:tabs:ws_slug:acme",
      JSON.stringify({ tabs: [existing], activeId: null }),
    );
    renderHook(() => useUrlTabSync());
    expect(useTabsStore.getState().tabs).toHaveLength(1);
    expect(useTabsStore.getState().activeId).toBe("pre");
  });

  it("navigateToTab(kind,id) pushes URL for new tab", () => {
    const { result } = renderHook(() => useUrlTabSync());
    act(() =>
      result.current.navigateToTab(
        { kind: "note", targetId: "n-5" },
        { mode: "push" },
      ),
    );
    expect(push).toHaveBeenCalledWith("/w/acme/n/n-5");
  });

  it("note URL adds a preview tab", () => {
    renderHook(() => useUrlTabSync());
    const s = useTabsStore.getState();
    expect(s.tabs).toHaveLength(1);
    expect(s.tabs[0].preview).toBe(true);
  });

  it("replaces an existing preview tab when navigating to another note", () => {
    const { rerender } = renderHook(() => useUrlTabSync());
    expect(useTabsStore.getState().tabs).toHaveLength(1);
    expect(useTabsStore.getState().tabs[0].targetId).toBe("n-1");

    // Simulate the user single-clicking a second note in the sidebar while
    // the first is still in preview mode. Only one preview tab should exist.
    act(() => {
      currentPath = "/w/acme/n/n-2";
    });
    rerender();

    const tabs = useTabsStore.getState().tabs;
    expect(tabs).toHaveLength(1);
    expect(tabs[0].targetId).toBe("n-2");
    expect(tabs[0].preview).toBe(true);
  });

  it("keeps a pinned tab when visiting a new note route (preview replace only)", () => {
    const pinned: Tab = {
      id: "pin",
      kind: "note",
      targetId: "n-pinned",
      mode: "plate",
      title: "pinned",
      pinned: true,
      preview: false,
      dirty: false,
      splitWith: null,
      splitSide: null,
      scrollY: 0,
    };
    localStorage.setItem(
      "oc:tabs:ws_slug:acme",
      JSON.stringify({ tabs: [pinned], activeId: "pin", closedStack: [] }),
    );
    renderHook(() => useUrlTabSync());
    // The pinned tab survives + the new note opens as a preview.
    const tabs = useTabsStore.getState().tabs;
    expect(tabs.map((t) => t.id).includes("pin")).toBe(true);
    expect(tabs).toHaveLength(2);
    expect(tabs.find((t) => t.targetId === "n-1")?.preview).toBe(true);
  });

  it("non-note kinds do not replace an existing preview tab", () => {
    // Open a note preview tab first.
    const { rerender } = renderHook(() => useUrlTabSync());
    expect(useTabsStore.getState().tabs).toHaveLength(1);

    // Navigate to dashboard — a non-preview kind. The note preview should
    // stay; dashboard is appended.
    act(() => {
      currentPath = "/w/acme/";
    });
    rerender();

    const tabs = useTabsStore.getState().tabs;
    expect(tabs).toHaveLength(2);
    expect(tabs.find((t) => t.kind === "dashboard")?.preview).toBe(false);
    expect(tabs.find((t) => t.kind === "note")?.preview).toBe(true);
  });

  it("navigateToTab with mode=replace uses router.replace", () => {
    const { result } = renderHook(() => useUrlTabSync());
    act(() =>
      result.current.navigateToTab(
        { kind: "dashboard", targetId: null },
        { mode: "replace" },
      ),
    );
    expect(replace).toHaveBeenCalledWith("/w/acme/");
  });
});
