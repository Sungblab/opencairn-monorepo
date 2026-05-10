import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}

describe("legacy project sidebar route boundary", () => {
  it("keeps the legacy project layout behind a dynamic sidebar loader", () => {
    const source = read(
      "src/app/[locale]/workspace/[wsSlug]/project/[projectId]/layout.tsx",
    );

    expect(source).toContain("SidebarLoader");
    expect(source).not.toMatch(/from\s+["']@\/components\/sidebar\/Sidebar["']/);
  });

  it("loads the legacy sidebar dynamically", () => {
    const loaderPath = "src/components/sidebar/SidebarLoader.tsx";

    expect(existsSync(join(root, loaderPath))).toBe(true);
    const source = read(loaderPath);
    expect(source).toContain("next/dynamic");
    expect(source).toContain('import("./Sidebar")');
  });
});
