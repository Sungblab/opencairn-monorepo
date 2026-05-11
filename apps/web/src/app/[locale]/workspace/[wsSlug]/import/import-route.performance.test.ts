import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}

describe("import route bundle boundaries", () => {
  it("keeps the retired import page as a server redirect", () => {
    const importPage = read("src/app/[locale]/workspace/[wsSlug]/import/page.tsx");
    const jobPage = read(
      "src/app/[locale]/workspace/[wsSlug]/import/jobs/[id]/page.tsx",
    );

    expect(importPage).toContain("redirect(");
    expect(importPage).not.toContain("ImportTabsLoader");
    expect(importPage).not.toMatch(/from\s+["']\.\/ImportTabs["']/);
    expect(jobPage).toContain("JobProgressLoader");
    expect(jobPage).not.toMatch(/from\s+["']\.\/JobProgress["']/);
  });

  it("keeps legacy import clients dynamic while they remain in the tree", () => {
    const loaders = [
      [
        "src/app/[locale]/workspace/[wsSlug]/import/DriveTabLoader.tsx",
        'import("./DriveTab")',
      ],
      [
        "src/app/[locale]/workspace/[wsSlug]/import/MarkdownTabLoader.tsx",
        'import("./MarkdownTab")',
      ],
      [
        "src/app/[locale]/workspace/[wsSlug]/import/NotionTabLoader.tsx",
        'import("./NotionTab")',
      ],
      [
        "src/app/[locale]/workspace/[wsSlug]/import/jobs/[id]/JobProgressLoader.tsx",
        'import("./JobProgress")',
      ],
    ] as const;

    for (const [path, importString] of loaders) {
      expect(existsSync(join(root, path))).toBe(true);
      const source = read(path);
      expect(source).toContain("next/dynamic");
      expect(source).toContain(importString);
    }
  });
});
