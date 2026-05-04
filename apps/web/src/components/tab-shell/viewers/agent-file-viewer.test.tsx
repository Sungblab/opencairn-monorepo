import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentFileSummary } from "@opencairn/shared";
import type { Tab } from "@/stores/tabs-store";
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
      jsonTree: "JSON 트리",
      csvTable: "CSV 테이블 · {rows}행",
      column: "열 {index}",
      download: "원본 다운로드",
      ingest: "인제스트 실행",
      compile: "LaTeX 컴파일",
      canvas: "캔버스로 실행",
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

function mockAgentFile(file: AgentFileSummary, body: string) {
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
      return new Response("not found", { status: 404 });
    }),
  );
}

function renderViewer(file: AgentFileSummary, body: string) {
  mockAgentFile(file, body);
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
  });

  it("renders markdown preview beside the source and version toolbar", async () => {
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
    expect(screen.getByText("원본")).toBeInTheDocument();
  });

  it("renders csv as a table while keeping the raw source visible", async () => {
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
    expect(screen.getByText(/name,score/)).toBeInTheDocument();
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
});
