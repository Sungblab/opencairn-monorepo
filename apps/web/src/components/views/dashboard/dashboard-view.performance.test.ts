import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}

describe("DashboardView route bundle boundary", () => {
  it("keeps the workspace dashboard route behind a dynamic DashboardView loader", () => {
    const page = read("src/app/[locale]/workspace/[wsSlug]/(shell)/page.tsx");

    expect(page).toContain("DashboardViewLoader");
    expect(page).not.toMatch(
      /from\s+["']@\/components\/views\/dashboard\/dashboard-view["']/,
    );
  });

  it("loads DashboardView through a route-level dynamic boundary", () => {
    const loaderPath = "src/components/views/dashboard/dashboard-view-loader.tsx";

    expect(existsSync(join(root, loaderPath))).toBe(true);
    const loader = read(loaderPath);
    expect(loader).toContain("next/dynamic");
    expect(loader).toContain('import("./dashboard-view")');
  });
});
