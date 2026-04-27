import type { useRouter } from "next/navigation";
import { usePanelStore } from "@/stores/panel-store";

export type PaletteRouter = ReturnType<typeof useRouter>;

export interface PaletteAction {
  id: string;
  /** Translation key under the `palette.actions.*` namespace. */
  labelKey: string;
  /** Display-only — the actual binding lives in shell-providers. */
  shortcut?: string;
  run(router: PaletteRouter): void;
}

// All actions are pure functions of (router, locale, optional wsSlug). We
// rebuild the list per-render so the locale + workspace switch is reflected
// without a stale closure. Keeping it a function rather than a top-level
// const lets us avoid `require()` for the panel store (Plan snippet used
// CommonJS — Next 16 ESM rejects it at runtime).
export function buildActions(opts: {
  locale: string;
  wsSlug?: string;
}): PaletteAction[] {
  const { locale, wsSlug } = opts;
  const wsBase = wsSlug ? `/${locale}/app/w/${wsSlug}` : null;
  const actions: PaletteAction[] = [];
  if (wsBase) {
    actions.push(
      { id: "dashboard", labelKey: "dashboard", run: (r) => r.push(`${wsBase}/`) },
      { id: "research", labelKey: "research", run: (r) => r.push(`${wsBase}/research`) },
      { id: "import", labelKey: "import", run: (r) => r.push(`${wsBase}/import`) },
      {
        id: "ws-settings",
        labelKey: "wsSettings",
        run: (r) => r.push(`${wsBase}/settings`),
      },
      {
        id: "new-project",
        labelKey: "newProject",
        run: (r) => r.push(`${wsBase}/new-project`),
      },
    );
  }
  actions.push({
    id: "profile",
    labelKey: "profile",
    run: (r) => r.push(`/${locale}/settings/profile`),
  });
  // Panel toggles only mean something inside the (shell) route group — the
  // panel store is wired to AppShell, so calling them on /settings or
  // /onboarding is a silent no-op for the user. Hide them outside shell so
  // the palette doesn't advertise actions that visibly do nothing.
  if (wsBase) {
    actions.push(
      {
        id: "toggle-sidebar",
        labelKey: "toggleSidebar",
        shortcut: "⌘\\",
        run: () => usePanelStore.getState().toggleSidebar(),
      },
      {
        id: "toggle-agent",
        labelKey: "toggleAgent",
        shortcut: "⌘J",
        run: () => usePanelStore.getState().toggleAgentPanel(),
      },
    );
  }
  return actions;
}
