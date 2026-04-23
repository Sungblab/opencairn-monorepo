import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NodeApi } from "react-arborist";
import { ProjectTreeNode } from "./project-tree-node";
import type { TreeNode } from "@/hooks/use-project-tree";
import { useTabsStore } from "@/stores/tabs-store";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useParams: () => ({ wsSlug: "acme" }),
}));

vi.mock("next-intl", () => ({
  useLocale: () => "ko",
}));

function mkNode(
  data: TreeNode,
  overrides: Partial<NodeApi<TreeNode>> = {},
): NodeApi<TreeNode> {
  // Only the fields the renderer actually touches; the rest are filled with
  // noops so TypeScript is satisfied without pulling in arborist internals.
  return {
    id: data.id,
    data,
    level: 0,
    isOpen: false,
    toggle: vi.fn(),
    ...overrides,
  } as unknown as NodeApi<TreeNode>;
}

function renderNode(node: NodeApi<TreeNode>) {
  return render(
    <ProjectTreeNode
      node={node}
      style={{}}
      dragHandle={() => {}}
      tree={{} as never}
    />,
  );
}

describe("ProjectTreeNode", () => {
  beforeEach(() => {
    push.mockClear();
    useTabsStore.setState(useTabsStore.getInitialState(), true);
  });

  it("renders a folder row with chevron and child count", () => {
    const node = mkNode({
      kind: "folder",
      id: "f1",
      parent_id: null,
      label: "Archive",
      child_count: 3,
    });
    renderNode(node);
    expect(screen.getByText("Archive")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByTestId("tree-chevron")).toBeInTheDocument();
  });

  it("renders a leaf folder without chevron", () => {
    const node = mkNode({
      kind: "folder",
      id: "f2",
      parent_id: null,
      label: "Empty",
      child_count: 0,
    });
    renderNode(node);
    expect(screen.queryByTestId("tree-chevron")).toBeNull();
  });

  it("clicking a folder row toggles open state", () => {
    const toggle = vi.fn();
    const node = mkNode(
      {
        kind: "folder",
        id: "f3",
        parent_id: null,
        label: "Notes",
        child_count: 1,
      },
      { toggle },
    );
    renderNode(node);
    fireEvent.click(screen.getByRole("treeitem"));
    expect(toggle).toHaveBeenCalledOnce();
    expect(push).not.toHaveBeenCalled();
  });

  it("clicking a note row pushes a locale-prefixed note route", () => {
    const node = mkNode({
      kind: "note",
      id: "n-1",
      parent_id: "f1",
      label: "Meeting",
      child_count: 0,
    });
    renderNode(node);
    fireEvent.click(screen.getByRole("treeitem"));
    expect(push).toHaveBeenCalledWith("/ko/app/w/acme/n/n-1");
  });

  it("activates an existing tab when its note is clicked again", () => {
    useTabsStore.setState({
      workspaceId: "ws-1",
      tabs: [
        {
          id: "t-1",
          kind: "note",
          targetId: "n-1",
          mode: "plate",
          title: "Meeting",
          pinned: false,
          preview: false,
          dirty: false,
          splitWith: null,
          splitSide: null,
          scrollY: 0,
        },
      ],
      activeId: null,
    });
    const node = mkNode({
      kind: "note",
      id: "n-1",
      parent_id: "f1",
      label: "Meeting",
      child_count: 0,
    });
    renderNode(node);
    fireEvent.click(screen.getByRole("treeitem"));
    expect(useTabsStore.getState().activeId).toBe("t-1");
  });
});
