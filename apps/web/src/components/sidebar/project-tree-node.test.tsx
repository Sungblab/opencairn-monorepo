import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NodeApi } from "react-arborist";
import { ProjectTreeNode } from "./project-tree-node";
import {
  ProjectTreeContext,
  type ProjectTreeCtxValue,
} from "./project-tree-context";
import type { TreeNode } from "@/hooks/use-project-tree";
import { useTabsStore } from "@/stores/tabs-store";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useParams: () => ({ wsSlug: "acme" }),
}));

vi.mock("next-intl", () => ({
  useLocale: () => "ko",
  useTranslations: (ns?: string) => (key: string) =>
    ns ? `${ns}.${key}` : key,
}));

function mkNode(
  data: TreeNode,
  overrides: Partial<NodeApi<TreeNode>> = {},
): NodeApi<TreeNode> {
  return {
    id: data.id,
    data,
    level: 0,
    isOpen: false,
    toggle: vi.fn(),
    ...overrides,
  } as unknown as NodeApi<TreeNode>;
}

function mkCtx(overrides: Partial<ProjectTreeCtxValue> = {}): ProjectTreeCtxValue {
  return {
    renamingId: null,
    onStartRename: vi.fn(),
    onCommitRename: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  };
}

function renderNode(
  node: NodeApi<TreeNode>,
  ctx: ProjectTreeCtxValue = mkCtx(),
) {
  return {
    ctx,
    ...render(
      <ProjectTreeContext.Provider value={ctx}>
        <ProjectTreeNode
          node={node}
          style={{}}
          dragHandle={() => {}}
          tree={{} as never}
        />
      </ProjectTreeContext.Provider>,
    ),
  };
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
    expect(push).toHaveBeenCalledWith("/ko/workspace/acme/note/n-1");
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

  it("opens code workspaces in the tab shell without navigating to a note route", () => {
    const node = mkNode({
      kind: "code_workspace",
      id: "cw-1",
      parent_id: null,
      label: "Generated app",
      child_count: 0,
    });
    renderNode(node);
    fireEvent.click(screen.getByRole("treeitem"));
    const [tab] = useTabsStore.getState().tabs;
    expect(tab).toMatchObject({
      kind: "code_workspace",
      targetId: "cw-1",
      mode: "code-workspace",
      title: "Generated app",
      preview: false,
    });
    expect(push).not.toHaveBeenCalled();
  });

  it("F2 triggers onStartRename for the focused row", () => {
    const onStartRename = vi.fn();
    const node = mkNode({
      kind: "note",
      id: "n-7",
      parent_id: null,
      label: "Rename me",
      child_count: 0,
    });
    renderNode(node, mkCtx({ onStartRename }));
    fireEvent.keyDown(screen.getByRole("treeitem"), { key: "F2" });
    expect(onStartRename).toHaveBeenCalledWith("n-7");
  });

  it("double-clicking a row starts rename", () => {
    const onStartRename = vi.fn();
    const node = mkNode({
      kind: "folder",
      id: "f4",
      parent_id: null,
      label: "Docs",
      child_count: 0,
    });
    renderNode(node, mkCtx({ onStartRename }));
    fireEvent.doubleClick(screen.getByRole("treeitem"));
    expect(onStartRename).toHaveBeenCalledWith("f4");
  });

  it("renders an input when the row is the renaming target", () => {
    const onCommitRename = vi.fn();
    const node = mkNode({
      kind: "note",
      id: "n-9",
      parent_id: null,
      label: "Draft",
      child_count: 0,
    });
    renderNode(
      node,
      mkCtx({ renamingId: "n-9", onCommitRename }),
    );
    const input = screen.getByDisplayValue("Draft") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Final" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommitRename).toHaveBeenCalledWith("n-9", "note", "Final");
  });

  it("Escape in the rename input commits a null (cancel)", () => {
    const onCommitRename = vi.fn();
    const node = mkNode({
      kind: "folder",
      id: "f-9",
      parent_id: null,
      label: "Notes",
      child_count: 2,
    });
    renderNode(
      node,
      mkCtx({ renamingId: "f-9", onCommitRename }),
    );
    const input = screen.getByDisplayValue("Notes") as HTMLInputElement;
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onCommitRename).toHaveBeenCalledWith("f-9", "folder", null);
  });
});
