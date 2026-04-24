import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { ResolveTabTitle } from "./resolve-tab-title";
import type { Tab } from "@/stores/tabs-store";

// Fixture: only the keys actually referenced by the tests. Phase 3-B task 1
// is plumbing only — no new i18n keys introduced here (task 11 handles
// parity). These keys already exist in apps/web/messages/*/app-shell.json.
const messages = {
  appShell: {
    tabTitles: {
      dashboard: "대시보드",
      research_run: "Research {id}",
    },
  },
};

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

function renderWithIntl(ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="ko" messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("ResolveTabTitle", () => {
  it("renders the translated titleKey", () => {
    const tab: Tab = {
      ...baseTab,
      titleKey: "appShell.tabTitles.dashboard",
    };
    const { container } = renderWithIntl(<ResolveTabTitle tab={tab} />);
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
    const { container } = renderWithIntl(<ResolveTabTitle tab={tab} />);
    expect(container.textContent).toBe("Research r-42");
  });

  it("falls back to tab.title when titleKey is absent (note tabs)", () => {
    const tab: Tab = {
      ...baseTab,
      kind: "note",
      targetId: "n-1",
      title: "My DB-sourced note",
    };
    const { container } = renderWithIntl(<ResolveTabTitle tab={tab} />);
    expect(container.textContent).toBe("My DB-sourced note");
  });

  it("falls back to tab.title when titleKey points at a missing message", () => {
    const tab: Tab = {
      ...baseTab,
      title: "cached-fallback",
      titleKey: "appShell.tabTitles.nonexistent",
    };
    const { container } = renderWithIntl(<ResolveTabTitle tab={tab} />);
    expect(container.textContent).toBe("cached-fallback");
  });
});
