import type { Tab, TabKind, TabMode } from "@/stores/tabs-store";

// `t_` prefix kept for debuggability — tab ids stand out in devtools / logs.
// UUID, not Date.now+random, because rapid tab opens (deep-link prefetch,
// hotkey repeat) would otherwise collide on the same millisecond.
export function genTabId(): string {
  return `t_${crypto.randomUUID()}`;
}

function defaultMode(_kind: TabKind): TabMode {
  // Plate is the only first-class editor in Phase 3. Reading mode is reached
  // via the per-tab mode switcher in a later plan; source / data / artifact
  // viewers land alongside their respective backend endpoints (Plan 3-B).
  return "plate";
}

function defaultPreview(kind: TabKind): boolean {
  // Only notes "preview" on single sidebar click. Dashboard / project /
  // research hub tabs always open as real tabs — there's no ephemeral
  // browsing flow for them.
  return kind === "note";
}

export interface NewTabOptions {
  kind: TabKind;
  targetId: string | null;
  /**
   * Title must be resolved by the caller — the factory is i18n-agnostic so
   * that ko/en switch at runtime doesn't require a second pass through
   * every tab. Callers typically use `useTranslations("appShell.tabTitles")`
   * to fill this in.
   */
  title: string;
  mode?: TabMode;
  preview?: boolean;
}

export function newTab(opts: NewTabOptions): Tab {
  return {
    id: genTabId(),
    kind: opts.kind,
    targetId: opts.targetId,
    mode: opts.mode ?? defaultMode(opts.kind),
    title: opts.title,
    pinned: false,
    preview: opts.preview ?? defaultPreview(opts.kind),
    dirty: false,
    splitWith: null,
    splitSide: null,
    scrollY: 0,
  };
}
