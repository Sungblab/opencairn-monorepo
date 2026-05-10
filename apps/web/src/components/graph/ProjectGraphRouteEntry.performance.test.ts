import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}

describe("ProjectGraph route bundle boundary", () => {
  it("keeps the graph route entry behind a dynamic loader", () => {
    const page = read(
      "src/app/[locale]/workspace/[wsSlug]/(shell)/project/[projectId]/graph/page.tsx",
    );
    const loader = read("src/components/graph/ProjectGraphRouteEntryLoader.tsx");

    expect(page).toContain("ProjectGraphRouteEntryLoader");
    expect(page).not.toMatch(
      /from\s+["']@\/components\/graph\/ProjectGraphRouteEntry["']/,
    );
    expect(loader).toContain("dynamic<ProjectGraphRouteEntryProps>");
    expect(loader).toContain('import("./ProjectGraphRouteEntry")');
  });

  it("keeps the graph renderer out of the route entry chunk", () => {
    const entry = read("src/components/graph/ProjectGraphRouteEntry.tsx");

    expect(entry).not.toMatch(/from\s+["']\.\/ProjectGraph["']/);
    expect(entry).toContain("./ProjectGraphLoader");

    const loader = read("src/components/graph/ProjectGraphLoader.tsx");
    expect(loader).toContain("dynamic<ProjectGraphProps>");
    expect(loader).toContain('import("./ProjectGraph")');
    expect(loader).toContain("ProjectGraphSkeleton");
  });

  it("keeps the AI visualize dialog out of the default graph viewer chunk", () => {
    const graph = read("src/components/graph/ProjectGraph.tsx");

    expect(graph).not.toMatch(
      /import\s+\{\s*VisualizeDialog\s*\}\s+from\s+["']\.\/ai\/VisualizeDialog["']/,
    );
    expect(graph).toContain("dynamic<VisualizeDialogProps>");
    expect(graph).toContain('import("./ai/VisualizeDialog")');
  });
});
