import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useResolvedTabTitle } from "./resolve-tab-title";
import { TestShellLabelsProvider } from "@/components/shell/shell-labels.test-utils";
import type { Tab } from "@/stores/tabs-store";

const baseTab: Tab = {
  id: "t1",
  kind: "dashboard",
  targetId: null,
  mode: "plate",
  // Distinctive fallback — any test that renders this value means the
  // titleKey resolver failed to pick up the translated string.
  title: "FALLBACK_DO_NOT_RENDER",
  pinned: false,
  preview: false,
  dirty: false,
  splitWith: null,
  splitSide: null,
  scrollY: 0,
};

// Inline probe — we can't call `useResolvedTabTitle` at the top level of a
// test because it's a hook. The probe renders the resolved string as text so
// we can assert on `container.textContent`.
function Probe({ tab }: { tab: Tab }) {
  return <>{useResolvedTabTitle(tab)}</>;
}

function renderWithIntl(ui: React.ReactNode) {
  return render(<TestShellLabelsProvider>{ui}</TestShellLabelsProvider>);
}

describe("useResolvedTabTitle", () => {
  it("renders the translated titleKey", () => {
    const tab: Tab = {
      ...baseTab,
      titleKey: "appShell.tabTitles.dashboard",
    };
    const { container } = renderWithIntl(<Probe tab={tab} />);
    expect(container.textContent).toBe("대시보드");
  });

  it("interpolates titleParams into the translated string", () => {
    const tab: Tab = {
      ...baseTab,
      kind: "research_run",
      targetId: "r-42",
      titleKey: "appShell.tabTitles.research_run",
      titleParams: { id: "r-42" },
    };
    const { container } = renderWithIntl(<Probe tab={tab} />);
    expect(container.textContent).toBe("Research r-42");
  });

  it("falls back to tab.title when titleKey is absent (note tabs)", () => {
    const tab: Tab = {
      ...baseTab,
      kind: "note",
      targetId: "n-1",
      title: "My DB-sourced note",
    };
    const { container } = renderWithIntl(<Probe tab={tab} />);
    expect(container.textContent).toBe("My DB-sourced note");
  });

  it("falls back to tab.title when titleKey points at a missing message", () => {
    const tab: Tab = {
      ...baseTab,
      title: "cached-fallback",
      titleKey: "appShell.tabTitles.nonexistent",
    };
    const { container } = renderWithIntl(<Probe tab={tab} />);
    expect(container.textContent).toBe("cached-fallback");
  });
});
