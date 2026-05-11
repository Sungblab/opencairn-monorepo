import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}

describe("AppShell bundle boundary", () => {
  it("uses server-resolved shell labels instead of next-intl in the initial shell chunk", () => {
    const shellLayout = read(
      "src/app/[locale]/workspace/[wsSlug]/(shell)/layout.tsx",
    );
    const shellProviders = read("src/components/shell/shell-providers.tsx");
    const appShell = read("src/components/shell/app-shell.tsx");

    expect(shellLayout).toContain("@/components/shell/get-shell-labels");
    expect(shellLayout).toContain("getShellLabels()");
    expect(shellLayout).toContain("shellLabels=");
    expect(shellProviders).toContain("ShellLabelsProvider");
    expect(appShell).toContain("@/components/shell/shell-labels");
    expect(appShell).not.toContain("next-intl");
    expect(appShell).not.toContain("useTranslations");
  });

  it("keeps compact sheet UI out of the default desktop shell chunk", () => {
    const appShell = read("src/components/shell/app-shell.tsx");

    expect(appShell).not.toMatch(/from\s+["']@\/components\/ui\/sheet["']/);
    expect(appShell).toContain("./compact-app-shell-loader");

    const loader = read("src/components/shell/compact-app-shell-loader.tsx");
    expect(loader).toContain("lazy(");
    expect(loader).toContain('import("./compact-app-shell")');

    const compact = read("src/components/shell/compact-app-shell.tsx");
    expect(compact).toContain("@/components/ui/sheet");
  });

  it("loads the heavy agent panel through the lazy loader instead of importing it directly", () => {
    const appShell = read("src/components/shell/app-shell.tsx");
    const loader = read("src/components/agent-panel/agent-panel-loader.tsx");

    expect(appShell).not.toMatch(
      /from\s+["']@\/components\/agent-panel\/agent-panel["']/,
    );
    expect(appShell).toContain("@/components/agent-panel/agent-panel-loader");
    expect(loader).toContain("dynamic<{ wsSlug?: string }>");
    expect(loader).toContain('import("./agent-panel")');
    expect(loader).toContain("@/lib/performance/use-idle-ready");
    expect(loader).toContain("useIdleReady({ timeout: 1500, fallbackMs: 750 })");
    expect(loader).toContain("return ready ? <AgentPanel wsSlug={wsSlug} />");
  });

  it("loads the app sidebar through a lazy loader", () => {
    const appShell = read("src/components/shell/app-shell.tsx");

    expect(appShell).not.toMatch(
      /from\s+["']@\/components\/sidebar\/shell-sidebar["']/,
    );
    expect(appShell).toContain("@/components/sidebar/shell-sidebar-loader");

    const loader = read("src/components/sidebar/shell-sidebar-loader.tsx");
    expect(loader).toContain("dynamic<ShellSidebarProps>");
    expect(loader).toContain('import("./shell-sidebar")');
    expect(loader).toContain("@/lib/performance/use-idle-ready");
    expect(loader).toContain("useIdleReady({ timeout: 1200, fallbackMs: 400 })");
    expect(loader).toContain("return ready ? <LazyShellSidebar {...props} />");
    expect(loader).toContain("ShellSidebarSkeleton");
  });

  it("keeps background ingest notifications out of the default shell chunk", () => {
    const appShell = read("src/components/shell/app-shell.tsx");

    expect(appShell).not.toMatch(
      /from\s+["']@\/components\/ingest\/ingest-overlays["']/,
    );
    expect(appShell).toContain(
      "@/components/ingest/ingest-overlays-loader",
    );

    const loader = read("src/components/ingest/ingest-overlays-loader.tsx");
    expect(loader).toContain("dynamic");
    expect(loader).toContain('import("./ingest-overlays")');
    expect(loader).toContain("@/lib/performance/use-idle-ready");
    expect(loader).toContain("useIdleReady({ timeout: 2000, fallbackMs: 1000 })");
    expect(loader).toContain("return ready ? <LazyIngestOverlays /> : null");
    expect(loader).not.toContain("NEXT_PUBLIC_FEATURE_LIVE_INGEST");
  });

  it("lazy-loads non-critical shell keyboard shortcut wiring", () => {
    const providers = read("src/components/shell/shell-providers.tsx");

    expect(providers).not.toMatch(
      /from\s+["']@\/hooks\/use-tab-keyboard["']/,
    );
    expect(providers).not.toMatch(
      /from\s+["']@\/hooks\/use-tab-mode-shortcut["']/,
    );
    expect(providers).not.toMatch(
      /from\s+["']@\/hooks\/use-keyboard-shortcut["']/,
    );
    expect(providers).toContain("./shell-keyboard-shortcuts-loader");

    const loader = read(
      "src/components/shell/shell-keyboard-shortcuts-loader.tsx",
    );
    expect(loader).toContain("@/lib/performance/use-idle-ready");
    expect(loader).toContain("useIdleReady({ timeout: 1500, fallbackMs: 750 })");
    expect(loader).toContain("lazy(");
    expect(loader).toContain('import("./shell-keyboard-shortcuts")');
    expect(loader).toContain("return ready ? (");

    const shortcuts = read("src/components/shell/shell-keyboard-shortcuts.tsx");
    expect(shortcuts).toContain("@/hooks/use-tab-keyboard");
    expect(shortcuts).toContain("@/hooks/use-tab-mode-shortcut");
    expect(shortcuts).toContain("@/hooks/use-keyboard-shortcut");
  });

  it("keeps panel preferences off the zustand middleware chunk", () => {
    const panelStore = read("src/stores/panel-store.ts");

    expect(panelStore).not.toContain("zustand/middleware");
    expect(panelStore).not.toContain("persist(");
    expect(panelStore).toContain("persistPanelState");
    expect(panelStore).toContain('PANEL_STORAGE_KEY = "oc:panel"');
  });
});
