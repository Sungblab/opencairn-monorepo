import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}

describe("TabModeRouter bundle boundary", () => {
  it("keeps routed viewer dispatch out of the default tab shell chunk", () => {
    const shell = read("src/components/tab-shell/tab-shell.tsx");

    expect(shell).toContain("TabModeRouterLoader");
    expect(shell).not.toMatch(/from\s+["']\.\/tab-mode-router["']/);

    const loader = read("src/components/tab-shell/tab-mode-router-loader.tsx");
    expect(loader).toContain("next/dynamic");
    expect(loader).toContain('import("./tab-mode-router")');
  });

  it("dispatches through lazy viewer loaders instead of statically importing routed viewers", () => {
    const router = read("src/components/tab-shell/tab-mode-router.tsx");

    expect(router).toContain("./routed-viewer-loader");
    expect(router).not.toMatch(/from\s+["']\.\/viewers\/reading-viewer["']/);
    expect(router).not.toMatch(/from\s+["']\.\/viewers\/source-viewer["']/);
    expect(router).not.toMatch(/from\s+["']\.\/viewers\/canvas-viewer["']/);
    expect(router).not.toMatch(/from\s+["']\.\/viewers\/lit-search-viewer["']/);
    expect(router).not.toMatch(/from\s+["']\.\/viewers\/agent-file-viewer["']/);
    expect(router).not.toMatch(/from\s+["']\.\/viewers\/code-workspace-viewer["']/);
  });
});
