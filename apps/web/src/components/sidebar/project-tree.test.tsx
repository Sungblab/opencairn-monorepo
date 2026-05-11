import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { closeDeletedNoteTabs, ProjectTree } from "./project-tree";
import type { TreeNode } from "@/hooks/use-project-tree";
import { useSidebarStore } from "@/stores/sidebar-store";
import { useTabsStore } from "@/stores/tabs-store";

const uploadMock = vi.fn();

vi.mock("next-intl", () => ({
  useLocale: () => "ko",
  useTranslations: (ns?: string) => (key: string) =>
    ns ? `${ns}.${key}` : key,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/ko/workspace/acme/project/proj-1",
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/hooks/use-project-tree", () => ({
  treeQueryKey: (projectId: string, parentId: string | null) =>
    ["project-tree", projectId, parentId ?? "root"] as const,
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

vi.mock("@/hooks/use-ingest-upload", () => ({
  useIngestUpload: () => ({
    upload: uploadMock,
    isUploading: false,
    error: null,
  }),
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
        data-first-child-kind={data[0]?.children?.[0]?.kind ?? ""}
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
      <ProjectTree projectId="proj-1" workspaceSlug="acme" height={320} />
    </QueryClientProvider>,
  );
}

describe("ProjectTree", () => {
  beforeEach(() => {
    useSidebarStore.setState({ expanded: new Set() });
    useTabsStore.setState(useTabsStore.getInitialState(), true);
    uploadMock.mockReset();
    uploadMock.mockResolvedValue({
      workflowId: "wf-1",
      objectKey: "obj-1",
      sourceBundleNodeId: "bundle-1",
      originalFileId: "file-1",
    });
  });

  it("uses a taller row height for readable Notion-style navigation", () => {
    renderTree();

    expect(screen.getByTestId("arborist-tree")).toHaveAttribute(
      "data-row-height",
      "34",
    );
  });

  it("shows a placeholder child when an expandable row is open but empty", () => {
    useSidebarStore.setState({ expanded: new Set(["n-1"]) });
    renderTree();

    expect(screen.getByTestId("arborist-tree")).toHaveAttribute(
      "data-first-child-kind",
      "empty",
    );
  });

  it("opens the upload modal for dropped OS files before uploading", async () => {
    renderTree();
    const tree = screen.getByTestId("project-tree");
    const file = new File(["hello"], "paper.pdf", { type: "application/pdf" });

    fireEvent.dragEnter(tree, {
      dataTransfer: { files: [file], types: ["Files"] },
    });
    expect(screen.getByTestId("project-tree-drop-overlay")).toBeInTheDocument();

    fireEvent.drop(tree, {
      dataTransfer: { files: [file], types: ["Files"] },
    });

    expect(uploadMock).not.toHaveBeenCalled();
    expect(screen.getByText("sidebar.upload.title")).toBeInTheDocument();
    expect(
      screen.getByText("sidebar.upload.selected"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "sidebar.upload.start" }));

    await waitFor(() => expect(uploadMock).toHaveBeenCalledWith(file, "proj-1"));
    const tabs = useTabsStore.getState().tabs;
    expect(tabs.some((tab) => tab.kind === "ingest")).toBe(false);
    expect(tabs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "agent_file",
          targetId: "file-1",
          title: "paper.pdf",
          mode: "agent-file",
        }),
      ]),
    );
  });

  it("closes every open tab for a deleted note and promotes the neighbor", () => {
    useTabsStore.setState({
      workspaceId: "ws-1",
      tabs: [
        {
          id: "a",
          kind: "note",
          targetId: "note-deleted",
          mode: "plate",
          title: "Deleted",
          pinned: false,
          preview: false,
          dirty: false,
          splitWith: null,
          splitSide: null,
          scrollY: 0,
        },
        {
          id: "b",
          kind: "project",
          targetId: "proj-1",
          mode: "plate",
          title: "Project",
          pinned: false,
          preview: false,
          dirty: false,
          splitWith: null,
          splitSide: null,
          scrollY: 0,
        },
      ],
      activeId: "a",
      closedStack: [],
    });

    const result = closeDeletedNoteTabs("note-deleted");

    expect(result.closedActive).toBe(true);
    expect(result.nextActive?.id).toBe("b");
    expect(useTabsStore.getState().tabs).toHaveLength(1);
    expect(useTabsStore.getState().tabs[0]?.targetId).toBe("proj-1");
    expect(useTabsStore.getState().activeId).toBe("b");
  });
});
