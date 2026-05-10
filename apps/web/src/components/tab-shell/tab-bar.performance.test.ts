import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}

describe("TabBar bundle boundary", () => {
  it("uses shell label context instead of next-intl in the initial tab chrome", () => {
    for (const path of [
      "src/components/tab-shell/tab-bar.tsx",
      "src/components/tab-shell/tab-item.tsx",
      "src/components/tab-shell/static-tab-list-fallback.tsx",
      "src/components/tab-shell/tab-overflow-menu-loader.tsx",
      "src/lib/resolve-tab-title.tsx",
      "src/hooks/use-url-tab-sync.ts",
    ]) {
      const source = read(path);

      expect(source, path).not.toContain("next-intl");
      expect(source, path).not.toContain("useTranslations");
    }

    expect(read("src/components/tab-shell/tab-bar.tsx")).toContain(
      "@/components/shell/shell-labels",
    );
    expect(read("src/lib/resolve-tab-title.tsx")).toContain("useShellLabels");
    expect(read("src/hooks/use-url-tab-sync.ts")).toContain("useShellLabels");
  });

  it("keeps drag sorting libraries out of the default tab bar chunk", () => {
    const tabBar = read("src/components/tab-shell/tab-bar.tsx");

    expect(tabBar).not.toContain("@dnd-kit/");
    expect(tabBar).not.toMatch(/from\s+["']\.\/static-tab-list["']/);
    expect(tabBar).not.toMatch(/from\s+["']\.\/tab-item["']/);
    expect(tabBar).toContain("./static-tab-list-loader");
    expect(tabBar).toContain("./sortable-tab-list-loader");
    expect(tabBar).not.toContain("requestIdleCallback");
    expect(tabBar).not.toContain("setTimeout");
    expect(tabBar).not.toMatch(/from\s+["']\.\/tab-overflow-menu["']/);
    expect(tabBar).toContain("./tab-overflow-menu-loader");

    const staticLoader = read(
      "src/components/tab-shell/static-tab-list-loader.tsx",
    );
    expect(staticLoader).toContain("lazy(");
    expect(staticLoader).toContain('import("./static-tab-list")');

    const staticList = read("src/components/tab-shell/static-tab-list.tsx");
    expect(staticList).not.toContain("@/components/ui/context-menu");
    expect(staticList).not.toContain("./tab-context-menu");

    const loader = read(
      "src/components/tab-shell/sortable-tab-list-loader.tsx",
    );
    expect(loader).toContain("lazy(");
    expect(loader).toContain('import("./sortable-tab-list")');
    expect(loader).not.toMatch(/from\s+["']\.\/static-tab-list["']/);
    expect(loader).toContain("./static-tab-list-fallback");

    const sortable = read("src/components/tab-shell/sortable-tab-list.tsx");
    expect(sortable).toContain("@dnd-kit/core");
    expect(sortable).toContain("@dnd-kit/sortable");
    expect(sortable).toContain("@/components/ui/context-menu");

    const overflowLoader = read(
      "src/components/tab-shell/tab-overflow-menu-loader.tsx",
    );
    expect(overflowLoader).toContain("lazy(");
    expect(overflowLoader).toContain('import("./tab-overflow-menu")');
    expect(overflowLoader).toContain("useState(false)");
    expect(overflowLoader).toContain("openOnLoad");
    expect(overflowLoader).toContain('pointerType !== "touch"');
    expect(overflowLoader).toContain("menuRequested ?");
    expect(overflowLoader).toContain("onPointerEnter");
    expect(read("src/components/tab-shell/tab-overflow-menu.tsx")).toContain(
      "defaultOpen={initialOpen}",
    );
  });
});
