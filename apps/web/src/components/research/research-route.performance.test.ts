import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}

describe("research route bundle boundaries", () => {
  it("keeps research route pages behind dynamic client loaders", () => {
    const hubPage = read(
      "src/app/[locale]/workspace/[wsSlug]/(shell)/research/page.tsx",
    );
    const runPage = read(
      "src/app/[locale]/workspace/[wsSlug]/(shell)/research/[runId]/page.tsx",
    );

    expect(hubPage).toContain("ResearchHubLoader");
    expect(hubPage).not.toMatch(
      /from\s+["']@\/components\/research\/ResearchHub["']/,
    );
    expect(runPage).toContain("ResearchRunViewLoader");
    expect(runPage).not.toMatch(
      /from\s+["']@\/components\/research\/ResearchRunView["']/,
    );
  });

  it("loads research route clients dynamically", () => {
    const loaders = [
      [
        "src/components/research/ResearchHubLoader.tsx",
        'import("./ResearchHub")',
      ],
      [
        "src/components/research/ResearchRunViewLoader.tsx",
        'import("./ResearchRunView")',
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
