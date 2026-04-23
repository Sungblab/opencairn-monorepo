import { renderHook, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useUrlTabSync } from "./use-url-tab-sync";
import { useTabsStore, type Tab } from "@/stores/tabs-store";

const push = vi.fn();
const replace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
  usePathname: () => "/w/acme/n/n-1",
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
