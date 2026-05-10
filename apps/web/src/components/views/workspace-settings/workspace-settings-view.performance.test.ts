import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}

describe("WorkspaceSettingsView bundle boundary", () => {
  it("loads the full workspace settings view through the route loader", () => {
    const page = read(
      "src/app/[locale]/workspace/[wsSlug]/(shell)/settings/[[...slug]]/page.tsx",
    );

    expect(page).not.toMatch(
      /from\s+["']@\/components\/views\/workspace-settings\/workspace-settings-view["']/,
    );
    expect(page).toContain(
      "@/components/views/workspace-settings/workspace-settings-view-loader",
    );

    const loader = read(
      "src/components/views/workspace-settings/workspace-settings-view-loader.tsx",
    );
    expect(loader).toContain("dynamic<WorkspaceSettingsViewProps>");
    expect(loader).toContain('import("./workspace-settings-view")');
    expect(loader).toContain("WorkspaceSettingsViewSkeleton");
  });
});
