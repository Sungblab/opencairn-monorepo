import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentFileSummary } from "@opencairn/shared";
import type { Tab } from "@/stores/tabs-store";
import { useTabsStore } from "@/stores/tabs-store";
import { AgentFileViewer } from "./agent-file-viewer";

const messages = {
  agentFiles: {
    viewer: {
      loading: "파일을 불러오는 중...",
      loadingInline: "불러오는 중...",
      error: "파일을 열 수 없습니다.",
      meta: "{kind} · v{version} · {bytes}",
      preview: "미리보기",
      source: "원본",
      showSource: "원본 보기",
      hideSource: "원본 닫기",
      jsonTree: "JSON 트리",
      csvTable: "CSV 테이블 · {rows}행",
      column: "열 {index}",
      download: "원본 다운로드",
      ingest: "인제스트 실행",
      compile: "LaTeX 컴파일",
      canvas: "캔버스로 실행",
      googleExport: "Google Workspace로 내보내기",
      googleExportConnectRequired: "Google Drive 연결 필요",
      googleSettingsTitle: "Google Drive 설정",
      compileStatus: {
        not_started: "컴파일 대기",
        queued: "컴파일 대기열",
        running: "컴파일 중",
        completed: "컴파일 완료",
        failed: "컴파일 실패",
        disabled: "컴파일 없음",
      },
      ingestStatus: {
        not_started: "인제스트 전",
        queued: "인제스트 대기열",
        running: "인제스트 중",
        completed: "인제스트 완료",
        failed: "인제스트 실패",
      },
    },
  },
};

const tab: Tab = {
  id: "t",
  kind: "agent_file",
  targetId: "11111111-1111-4111-8111-111111111111",
  mode: "agent-file",
  title: "Report",
  titleKey: undefined,
  titleParams: undefined,
  pinned: false,
  preview: false,
  dirty: false,
  splitWith: null,
  splitSide: null,
  scrollY: 0,
};

function fileSummary(patch: Partial<AgentFileSummary>): AgentFileSummary {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    workspaceId: "22222222-2222-4222-8222-222222222222",
    projectId: "33333333-3333-4333-8333-333333333333",
    folderId: null,
    title: "Report",
    filename: "report.md",
    extension: "md",
    kind: "markdown",
    mimeType: "text/markdown",
    bytes: 2048,
    source: "agent_chat",
    versionGroupId: "44444444-4444-4444-8444-444444444444",
    version: 3,
    ingestWorkflowId: null,
    ingestStatus: "not_started",
    sourceNoteId: null,
    canvasNoteId: null,
    compileStatus: "disabled",
    compiledMimeType: null,
    createdAt: "2026-05-03T00:00:00.000Z",
    updatedAt: "2026-05-03T00:00:00.000Z",
    ...patch,
  };
}

function mockAgentFile(
  file: AgentFileSummary,
  body: string,
  options: { googleConnected?: boolean } = {},
) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith(`/api/agent-files/${file.id}`)) {
        return new Response(JSON.stringify({ file }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith(`/api/agent-files/${file.id}/file`)) {
        return new Response(body, {
          headers: { "content-type": file.mimeType },
        });
      }
      if (
        url.endsWith(
          `/api/integrations/google?workspaceId=${encodeURIComponent(file.workspaceId)}`,
        )
      ) {
        return new Response(
          JSON.stringify({
            connected: options.googleConnected ?? false,
            accountEmail: options.googleConnected ? "user@example.com" : null,
            scopes: options.googleConnected
              ? "https://www.googleapis.com/auth/drive.file"
              : null,
          }),
          { headers: { "content-type": "application/json" } },
        );
      }
      if (url.endsWith(`/api/projects/${file.projectId}/project-object-actions/export`)) {
        return new Response(
          JSON.stringify({
            action: { id: "action-1" },
            event: { type: "project_object_export_requested" },
            idempotent: false,
            workflowId: "google-workspace-export/request-1",
          }),
          { status: 202, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("not found", { status: 404 });
    }),
  );
}

function renderViewer(
  file: AgentFileSummary,
  body: string,
  options: { googleConnected?: boolean } = {},
) {
  mockAgentFile(file, body, options);
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="ko" messages={messages}>
        <AgentFileViewer tab={tab} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("AgentFileViewer", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    useTabsStore.setState({
      workspaceId: null,
      tabs: [],
      activeId: null,
      closedStack: [],
    });
  });

  it("renders markdown as a focused preview with the version toolbar", async () => {
    const file = fileSummary({});
    renderViewer(file, "# Report\n\n- first");

    expect(await screen.findByText("report.md")).toBeInTheDocument();
    expect(screen.getByText(/markdown · v3 · 2.0 KB/)).toBeInTheDocument();
    expect(screen.queryByText("컴파일 없음")).not.toBeInTheDocument();
    expect(screen.getByLabelText("원본 다운로드")).toHaveAttribute(
      "href",
      `/api/agent-files/${file.id}/file`,
    );
    expect(await screen.findByText("미리보기")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Report" })).toBeInTheDocument();
    expect(screen.queryByText("원본")).not.toBeInTheDocument();
  });

  it("syncs the tab title from loaded file metadata", async () => {
    const file = fileSummary({
      title: "분석 보고서",
      filename: "analysis.pdf",
      extension: "pdf",
      kind: "pdf",
      mimeType: "application/pdf",
    });
    useTabsStore.setState({
      workspaceId: "ws_slug:acme",
      tabs: [{ ...tab, title: "파일" }],
      activeId: tab.id,
      closedStack: [],
    });

    renderViewer(file, "pdf");

    await waitFor(() => {
      expect(useTabsStore.getState().tabs[0]?.title).toBe("분석 보고서");
    });
  });

  it("renders csv as a focused table with source available on demand", async () => {
    renderViewer(
      fileSummary({
        filename: "scores.csv",
        extension: "csv",
        kind: "csv",
        mimeType: "text/csv",
      }),
      "name,score\nAda,10\nLinus,8",
    );

    expect(await screen.findByText("CSV 테이블 · 2행")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "name" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Ada" })).toBeInTheDocument();
    expect(screen.queryByText(/name,score/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "원본 보기" }));

    expect(await screen.findByText(/name,score/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "원본 닫기" })).toBeInTheDocument();
  });

  it("renders json as a focused tree with source available on demand", async () => {
    renderViewer(
      fileSummary({
        filename: "data.json",
        extension: "json",
        kind: "json",
        mimeType: "application/json",
      }),
      '{"name":"Ada","score":10}',
    );

    expect(await screen.findByText("JSON 트리")).toBeInTheDocument();
    expect(screen.queryByText(/"name":"Ada"/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "원본 보기" }));

    expect(await screen.findByText(/"name":"Ada"/)).toBeInTheDocument();
  });

  it("renders html in a sandboxed preview with a source bridge", async () => {
    renderViewer(
      fileSummary({
        filename: "demo.html",
        extension: "html",
        kind: "html",
        mimeType: "text/html",
      }),
      "<h1>Hello</h1>",
    );

    const frame = await screen.findByTitle("demo.html");
    expect(frame).toHaveAttribute("src", `/api/agent-files/${tab.targetId}/file`);
    expect(frame).toHaveAttribute("sandbox", "allow-scripts");
    expect(screen.getByLabelText("캔버스로 실행")).toBeInTheDocument();
    expect(await screen.findByText(/<h1>Hello/)).toBeInTheDocument();
  });

  it("starts a Google Workspace export for compatible generated files", async () => {
    const file = fileSummary({
      filename: "brief.docx",
      extension: "docx",
      kind: "docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    renderViewer(file, "binary", { googleConnected: true });

    const button = await screen.findByLabelText("Google Workspace로 내보내기");
    fireEvent.click(button);

    await waitFor(() => {
      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        `/api/projects/${file.projectId}/project-object-actions/export`,
        expect.objectContaining({
          method: "POST",
          credentials: "include",
          body: JSON.stringify({
            type: "export_project_object",
            objectId: file.id,
            provider: "google_docs",
            format: "docx",
          }),
        }),
      );
    });
  });

  it("opens workspace integration settings when Google Drive is not connected", async () => {
    const file = fileSummary({
      filename: "brief.docx",
      extension: "docx",
      kind: "docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    renderViewer(file, "binary", { googleConnected: false });

    const button = await screen.findByLabelText("Google Drive 연결 필요");
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);

    await waitFor(() => {
      expect(useTabsStore.getState().tabs).toEqual([
        expect.objectContaining({
          kind: "ws_settings",
          targetId: "integrations",
        }),
      ]);
    });
  });
});
