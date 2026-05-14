import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Tab } from "@/stores/tabs-store";
import { CodeWorkspaceViewer } from "./code-workspace-viewer";

const tab: Tab = {
  id: "t-1",
  kind: "code_workspace",
  targetId: "00000000-0000-4000-8000-000000000001",
  mode: "code-workspace",
  title: "Demo app",
  pinned: false,
  preview: false,
  dirty: false,
  splitWith: null,
  splitSide: null,
  scrollY: 0,
};

const messages = {
  codeWorkspaces: {
    viewer: {
      loading: "불러오는 중",
      error: "열 수 없음",
      archive: "아카이브 다운로드",
      meta: "{files}개 파일 · {directories}개 폴더",
      bytes: "{bytes} B",
      currentSnapshot: "스냅샷 {id}",
    },
  },
};

function wrap(node: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider locale="ko" messages={messages}>
        {node}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("CodeWorkspaceViewer", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders a stored code workspace manifest and archive link", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        workspace: {
          id: tab.targetId,
          name: "Demo app",
          currentSnapshotId: "00000000-0000-4000-8000-000000000002",
        },
        snapshot: {
          id: "00000000-0000-4000-8000-000000000002",
          manifest: {
            entries: [
              { path: "src", kind: "directory" },
              { path: "src/App.tsx", kind: "file", bytes: 12, contentHash: "sha256:app" },
            ],
          },
        },
      }),
    } as Response);

    wrap(<CodeWorkspaceViewer tab={tab} />);

    await waitFor(() => expect(screen.getByText("Demo app")).toBeInTheDocument());
    expect(screen.getByText("src/App.tsx")).toBeInTheDocument();
    expect(screen.getByText("1개 파일 · 1개 폴더")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "아카이브 다운로드" })).toHaveAttribute(
      "href",
      `/api/code-workspaces/${tab.targetId}/snapshots/00000000-0000-4000-8000-000000000002/archive`,
    );
  });
});
