import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}

describe("AgentEntryPointsView bundle boundary", () => {
  it("loads the full agents view through the route loader", () => {
    const page = read(
      "src/app/[locale]/workspace/[wsSlug]/(shell)/project/[projectId]/agents/page.tsx",
    );

    expect(page).not.toMatch(
      /from\s+["']@\/components\/views\/agents\/agent-entrypoints-view["']/,
    );
    expect(page).toContain(
      "@/components/views/agents/agent-entrypoints-view-loader",
    );

    const loader = read(
      "src/components/views/agents/agent-entrypoints-view-loader.tsx",
    );
    expect(loader).toContain("dynamic<AgentEntryPointsViewProps>");
    expect(loader).toContain('import("./agent-entrypoints-view")');
    expect(loader).toContain("AgentEntryPointsViewSkeleton");
  });

  it("loads Workflow Console through a lazy panel instead of bundling its API and recovery details", () => {
    const entry = read("src/components/views/agents/agent-entrypoints-view.tsx");

    expect(entry).toContain("next/dynamic");
    expect(entry).toContain("./workflow-console-panel");
    expect(entry).not.toContain("workflowConsoleApi");
    expect(entry).not.toContain("agenticPlansApi");
    expect(entry).not.toContain("importJobsApi");
    expect(entry).not.toContain("WorkflowConsoleRunDetail");
    expect(entry).not.toContain("WorkflowConsoleRecoveryDetail");
  });

  it("loads the run detail sheet only after a run is selected", () => {
    const entry = read("src/components/views/agents/agent-entrypoints-view.tsx");

    expect(entry).not.toMatch(/from\s+["']@\/components\/ui\/sheet["']/);
    expect(entry).not.toContain("function RunDetailSheet");
    expect(entry).toContain("./run-detail-sheet-loader");

    const loader = read(
      "src/components/views/agents/run-detail-sheet-loader.tsx",
    );
    expect(loader).toContain("dynamic<RunDetailSheetProps>");
    expect(loader).toContain('import("./run-detail-sheet")');

    const sheet = read("src/components/views/agents/run-detail-sheet.tsx");
    expect(sheet).toContain("@/components/ui/sheet");
  });
});
