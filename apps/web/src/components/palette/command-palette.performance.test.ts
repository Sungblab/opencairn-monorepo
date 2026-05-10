import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = () =>
  readFileSync(join(process.cwd(), "src/components/palette/command-palette.tsx"), "utf8");

describe("CommandPalette bundle boundary", () => {
  it("loads the shortcut host through an idle-only app provider boundary", () => {
    const loaderPath = "src/components/palette/command-palette-loader.tsx";
    const loader = readFileSync(join(process.cwd(), loaderPath), "utf8");
    const providers = readFileSync(
      join(process.cwd(), "src/components/providers/locale-app-providers.tsx"),
      "utf8",
    );

    expect(existsSync(join(process.cwd(), loaderPath))).toBe(true);
    expect(providers).toContain("@/components/palette/command-palette-loader");
    expect(providers).not.toMatch(
      /from\s+["']@\/components\/palette\/command-palette["']/,
    );
    expect(loader).toContain("@/lib/performance/use-idle-ready");
    expect(loader).toContain("useIdleReady({ timeout: 2000, fallbackMs: 1000 })");
    expect(loader).toContain('import("./command-palette")');
  });

  it("keeps the always-mounted shortcut host free of the heavy dialog implementation", () => {
    const code = source();

    expect(code).not.toContain("@tanstack/react-query");
    expect(code).not.toContain("@/components/ui/command");
    expect(code).not.toContain("@/lib/api-client");
    expect(code).not.toContain("./palette-actions");
    expect(code).not.toContain("./palette-search");
  });
});
