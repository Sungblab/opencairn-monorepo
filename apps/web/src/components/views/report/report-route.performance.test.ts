import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}

describe("report route bundle boundary", () => {
  it("keeps the report route behind a dynamic client loader", () => {
    const source = read(
      "src/app/[locale]/workspace/[wsSlug]/(shell)/report/page.tsx",
    );

    expect(source).toContain("ReportIssueViewLoader");
    expect(source).not.toMatch(
      /from\s+["']@\/components\/views\/report\/report-issue-view["']/,
    );
  });

  it("loads the report issue view dynamically", () => {
    const loaderPath = "src/components/views/report/report-issue-view-loader.tsx";

    expect(existsSync(join(root, loaderPath))).toBe(true);
    const source = read(loaderPath);
    expect(source).toContain("next/dynamic");
    expect(source).toContain('import("./report-issue-view")');
  });
});
