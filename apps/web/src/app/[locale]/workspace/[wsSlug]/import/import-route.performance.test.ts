import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}

describe("import route bundle boundaries", () => {
  it("keeps import route pages behind dynamic client loaders", () => {
    const importPage = read("src/app/[locale]/workspace/[wsSlug]/import/page.tsx");
    const jobPage = read(
      "src/app/[locale]/workspace/[wsSlug]/import/jobs/[id]/page.tsx",
    );

    expect(importPage).toContain("ImportTabsLoader");
    expect(importPage).not.toMatch(/from\s+["']\.\/ImportTabs["']/);
    expect(jobPage).toContain("JobProgressLoader");
    expect(jobPage).not.toMatch(/from\s+["']\.\/JobProgress["']/);
  });

  it("loads import route clients dynamically", () => {
    const loaders = [
      [
        "src/app/[locale]/workspace/[wsSlug]/import/ImportTabsLoader.tsx",
        'import("./ImportTabs")',
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

  it("keeps inactive import tabs behind dynamic loaders", () => {
    const tabs = read("src/app/[locale]/workspace/[wsSlug]/import/ImportTabs.tsx");

    expect(tabs).toContain("FirstSourceIntakeLoader");
    expect(tabs).toContain("DriveTabLoader");
    expect(tabs).toContain("MarkdownTabLoader");
    expect(tabs).toContain("NotionTabLoader");
    expect(tabs).not.toMatch(/from\s+["']@\/components\/import\/first-source-intake["']/);
    expect(tabs).not.toMatch(/from\s+["']\.\/DriveTab["']/);
    expect(tabs).not.toMatch(/from\s+["']\.\/MarkdownTab["']/);
    expect(tabs).not.toMatch(/from\s+["']\.\/NotionTab["']/);
  });

  it("loads import tabs dynamically", () => {
    const loaders = [
      [
        "src/app/[locale]/workspace/[wsSlug]/import/FirstSourceIntakeLoader.tsx",
        'import("@/components/import/first-source-intake")',
      ],
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
    ] as const;

    for (const [path, importString] of loaders) {
      expect(existsSync(join(root, path))).toBe(true);
      const source = read(path);
      expect(source).toContain("next/dynamic");
      expect(source).toContain(importString);
    }
  });
});
