import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { ProjectTree } from "./project-tree";
import type { TreeNode } from "@/hooks/use-project-tree";

vi.mock("next-intl", () => ({
  useTranslations: (ns?: string) => (key: string) =>
    ns ? `${ns}.${key}` : key,
}));

vi.mock("@/hooks/use-project-tree", () => ({
  useProjectTree: () => ({
    roots: [
      {
        kind: "note",
        id: "n-1",
        parent_id: null,
        label: "Root note",
        child_count: 0,
      },
    ] satisfies TreeNode[],
    loadChildren: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-keyboard-shortcut", () => ({
  useKeyboardShortcut: vi.fn(),
}));

vi.mock("@/hooks/use-tree-keyboard", () => ({
  useTypeAhead: vi.fn(),
}));

vi.mock("react-arborist", () => ({
  Tree: vi.fn(
    ({
      rowHeight,
      data,
    }: {
      rowHeight: number;
      data: TreeNode[];
    }) => (
      <div
        data-testid="arborist-tree"
        data-row-height={rowHeight}
        data-node-count={data.length}
      />
    ),
  ),
}));

function renderTree() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <ProjectTree projectId="proj-1" height={320} />
    </QueryClientProvider>,
  );
}

describe("ProjectTree", () => {
  it("uses a taller row height for readable Notion-style navigation", () => {
    renderTree();

    expect(screen.getByTestId("arborist-tree")).toHaveAttribute(
      "data-row-height",
      "34",
    );
  });
});
