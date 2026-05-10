import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}

describe("ProjectView route bundle boundary", () => {
  it("keeps the project route page behind a dynamic ProjectView loader", () => {
    const page = read(
      "src/app/[locale]/workspace/[wsSlug]/(shell)/project/[projectId]/page.tsx",
    );

    expect(page).toContain("ProjectViewLoader");
    expect(page).not.toMatch(
      /from\s+["']@\/components\/views\/project\/project-view["']/,
    );
  });

  it("loads ProjectView through a route-level dynamic boundary", () => {
    const loaderPath = "src/components/views/project/project-view-loader.tsx";

    expect(existsSync(join(root, loaderPath))).toBe(true);
    const loader = read(loaderPath);
    expect(loader).toContain("next/dynamic");
    expect(loader).toContain('import("./project-view")');
  });
});
