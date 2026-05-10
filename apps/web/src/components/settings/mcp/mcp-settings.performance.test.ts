import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}

describe("MCP settings bundle boundary", () => {
  it("keeps MCP settings pages behind the dynamic client loader", () => {
    const standalone = read("src/app/[locale]/settings/mcp/page.tsx");
    const workspace = read(
      "src/components/views/workspace-settings/workspace-settings-view.tsx",
    );

    for (const source of [standalone, workspace]) {
      expect(source).toContain("McpSettingsClientLoader");
      expect(source).not.toMatch(
        /from\s+["']@\/components\/settings\/mcp\/McpSettingsClient["']/,
      );
    }
  });

  it("loads the MCP settings client dynamically", () => {
    const loaderPath = "src/components/settings/mcp/McpSettingsClientLoader.tsx";

    expect(existsSync(join(root, loaderPath))).toBe(true);
    const source = read(loaderPath);
    expect(source).toContain("next/dynamic");
    expect(source).toContain('import("./McpSettingsClient")');
  });

  it("defers provider-heavy standalone MCP runtime behind the loader", () => {
    const standalone = read("src/app/[locale]/settings/mcp/page.tsx");
    const loader = read("src/components/settings/mcp/McpSettingsClientLoader.tsx");
    const runtime = read(
      "src/components/settings/mcp/McpSettingsClientRuntime.tsx",
    );

    expect(standalone).not.toContain("LocaleAppProviders");
    expect(standalone).toContain("withProviders");
    expect(loader).toContain('import("./McpSettingsClientRuntime")');
    expect(runtime).toContain("LocaleAppProviders");
  });
});
