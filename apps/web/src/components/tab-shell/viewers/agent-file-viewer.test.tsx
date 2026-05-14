import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentFileSummary } from "@opencairn/shared";
import type { Tab } from "@/stores/tabs-store";
import { useTabsStore } from "@/stores/tabs-store";
import { AgentFileViewer } from "./agent-file-viewer";

vi.mock("next/navigation", () => ({
  useParams: () => ({ wsSlug: "acme" }),
  useRouter: () => ({ push: vi.fn() }),
}));

const pdfViewerMock = vi.hoisted(() => ({
  props: [] as Array<{
    config: {
      src: string;
      zoom?: {
        defaultZoomLevel?: string | number;
        zoomStep?: number;
        presets?: Array<{ name: string; value: string | number }>;
      };
      i18n?: {
        defaultLocale?: string;
        locales?: Array<{
          code: string;
          translations: {
            toolbar?: {
              close?: string;
              print?: string;
              protect?: string;
              screenshot?: string;
            };
            commands?: {
              zoom?: {
                fitWidth?: string;
              };
            };
            page?: {
              next?: string;
            };
            search?: {
              placeholder?: string;
            };
          };
        }>;
      };
    };
    style?: React.CSSProperties;
    onReady?: (registry: unknown) => void;
  }>,
}));

vi.mock("@embedpdf/react-pdf-viewer", () => ({
  ZoomMode: {
    FitWidth: "fit-width",
    FitPage: "fit-page",
  },
  PDFViewer: (props: {
    config: {
      src: string;
      zoom?: {
        defaultZoomLevel?: string | number;
        zoomStep?: number;
        presets?: Array<{ name: string; value: string | number }>;
      };
      i18n?: {
        defaultLocale?: string;
        locales?: Array<{
          code: string;
          translations: {
            toolbar?: {
              close?: string;
              print?: string;
              protect?: string;
              screenshot?: string;
            };
            commands?: {
              zoom?: {
                fitWidth?: string;
              };
            };
            page?: {
              next?: string;
            };
            search?: {
              placeholder?: string;
            };
          };
        }>;
      };
    };
    style?: React.CSSProperties;
    onReady?: (registry: unknown) => void;
  }) => {
    pdfViewerMock.props.push(props);
    return (
      <div
        data-testid="embedpdf-viewer"
        data-src={props.config.src}
        data-height={props.style?.height}
      />
    );
  },
}));

vi.mock("next/dynamic", () => ({
  default:
    (loader: () => Promise<React.ComponentType<Record<string, unknown>>>) =>
    (props: Record<string, unknown>) => {
      const React = require("react") as typeof import("react");
      const [Component, setComponent] =
        React.useState<React.ComponentType<Record<string, unknown>> | null>(
          null,
        );

      React.useEffect(() => {
        loader().then((loaded) => setComponent(() => loaded));
      }, []);

      if (!Component) return null;
      return <Component {...props} />;
    },
}));

const messages = {
  agentFiles: {
    viewer: {
      loading: "파일을 불러오는 중...",
      loadingInline: "불러오는 중...",
      error: "파일을 열 수 없습니다.",
      meta: "{kind} · v{version} · {bytes}",
      askAgent: "이 산출물로 질문하기",
      preview: "미리보기",
      source: "원본",
      showSource: "원본 보기",
      hideSource: "원본 닫기",
      jsonTree: "JSON 트리",
      studyArtifact: {
        label: "학습 자료",
        type: "{type}",
        sourceCount: "출처 {count}개",
        difficulty: "난이도 {difficulty}",
        tags: "태그: {tags}",
        questionCount: "문항 {count}개",
        cardCount: "카드 {count}개",
        sectionCount: "섹션 {count}개",
        itemCount: "항목 {count}개",
        front: "앞면",
        back: "뒷면",
        answer: "정답",
        explanation: "해설",
        sourceRefs: "근거 {count}개",
      },
      csvTable: "CSV 테이블 · {rows}행",
      column: "열 {index}",
      download: "원본 다운로드",
      ingest: "인제스트 실행",
      compile: "LaTeX 컴파일",
      canvas: "캔버스로 실행",
      googleExport: "Google Workspace로 내보내기",
      googleExportConnectRequired: "Google Drive 연결 필요",
      googleSettingsTitle: "Google Drive 설정",
      officeConvertingTitle: "PDF로 변환 중...",
      officeConvertingDescription:
        "변환이 끝나면 이 화면이 자동으로 PDF 뷰어로 바뀝니다.",
      advanced: "고급 보기",
      artifactFocus: {
        label: "산출물 집중",
        tocTitle: "목차",
        tocEmpty: "제목이 있는 섹션이 아직 없습니다.",
        citationsTitle: "페이지 근거",
        citationsEmpty: "페이지 앵커가 아직 없습니다.",
        openSource: "원본을 오른쪽에 열기",
        pageChip: "p. {page}",
        sourceTab: "원본",
        sourcePageTab: "원본 p. {page}",
        pdfHint: "원본과 나란히 열어 산출물의 근거를 확인합니다.",
      },
      material: {
        status: {
          not_started: "분석 전",
          queued: "분석 대기",
          running: "분석 중",
          completed: "분석 완료",
          failed: "분석 실패",
        },
        statusDetail: {
          notStarted: "자료 분석을 시작할 수 있습니다.",
          running: "자료를 분석하는 중입니다.",
          completed: "이 자료는 분석되어 에이전트 질문과 노트 생성에 바로 사용할 수 있습니다.",
          failed: "분석이 실패했습니다. 다시 분석을 실행하거나 원본 파일을 확인해 주세요.",
        },
        sourceNoteTab: "정리 노트",
        graphTab: "개념 위키",
        advanced: "고급 보기",
        actions: {
          note: "정리 노트",
          wiki: "개념 위키",
          summarize: "요약하기",
          citations: "인용 추출",
          report: "리포트",
          figure: "피규어",
          slides: "슬라이드",
          table: "표",
          research: "리서치",
          quiz: "퀴즈",
          reanalyze: "다시 분석",
          retry: "다시 시도",
          openExtract: "추출 노트 열기",
          openGraph: "그래프 열기",
          download: "다운로드",
        },
      },
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
  appShell: {
    viewers: {
      source: {
        drawing: {
          label: "PDF 그리기 도구",
          move: "이동",
          pen: "펜",
          highlighter: "형광펜",
          hintMove: "문서를 이동하거나 선택합니다.",
          hintPen: "PDF 위에 필기합니다.",
          hintHighlighter: "PDF 위에 형광펜으로 표시합니다.",
        },
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
      if (url.endsWith(`/api/agent-files/${file.id}/compiled`)) {
        return new Response(body, {
          headers: { "content-type": file.compiledMimeType ?? file.mimeType },
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
    pdfViewerMock.props = [];
    localStorage.clear();
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

  it("builds an artifact focus rail with generated headings and page citations", async () => {
    const file = fileSummary({
      sourceNoteId: "55555555-5555-4555-8555-555555555555",
    });
    useTabsStore.setState({
      workspaceId: "ws_slug:acme",
      tabs: [tab],
      activeId: tab.id,
      closedStack: [],
    });

    renderViewer(
      file,
      "# 분석 리포트\n\n## 방법\n\n핵심 근거는 표본 선택이다 [p. 3].\n\n## 한계\n\n추가 검증이 필요하다 (page 12). 독일어 원문은 (S. 9)에 있다. 한국어 교재는 15쪽을 참고한다.",
    );

    expect(await screen.findByTestId("artifact-focus-viewer")).toBeInTheDocument();
    expect(screen.getByText("목차")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "방법" })).toBeInTheDocument();
    expect(screen.getByText("페이지 근거")).toBeInTheDocument();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "p. 3" })).toBeEnabled(),
    );
    expect(screen.getByRole("button", { name: "p. 9" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "p. 15" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "p. 3" }));

    expect(
      JSON.parse(
        localStorage.getItem(
          "oc:pdf-view:source:55555555-5555-4555-8555-555555555555",
        ) ?? "{}",
      ),
    ).toMatchObject({ pageNumber: 3 });
    expect(useTabsStore.getState().split).toMatchObject({
      primaryTabId: tab.id,
    });
    expect(useTabsStore.getState().tabs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "note",
          targetId: "55555555-5555-4555-8555-555555555555",
          mode: "source",
        }),
      ]),
    );
  });

  it("keeps parsed page citations disabled when no source note is available", async () => {
    const file = fileSummary({ sourceNoteId: null });
    renderViewer(
      file,
      "# Review\n\nEvidence appears on [página 4] and [str. 8], but this generated file has no original source note.",
    );

    expect(await screen.findByTestId("artifact-focus-viewer")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "p. 4" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "p. 8" })).toBeDisabled();
  });

  it("renders structured study artifact JSON as an interactive study view", async () => {
    const file = fileSummary({
      title: "운영체제 퀴즈",
      filename: "quiz-set.json",
      extension: "json",
      kind: "json",
      mimeType: "application/json",
    });
    renderViewer(
      file,
      JSON.stringify({
        type: "quiz_set",
        title: "운영체제 퀴즈",
        sourceIds: ["note-1"],
        difficulty: "medium",
        tags: ["운영체제"],
        createdByRunId: "run-1",
        renderTargets: ["interactive_view", "json_file"],
        questions: [
          {
            id: "q1",
            kind: "multiple_choice",
            prompt: "페이지 테이블의 역할은 무엇인가?",
            choices: [
              { id: "a", text: "가상 주소를 물리 주소로 매핑한다" },
              { id: "b", text: "프로세스를 종료한다" },
            ],
            answer: { choiceId: "a" },
            explanation: "페이지 테이블은 주소 변환 정보를 담는다.",
            sourceRefs: [{ sourceId: "note-1", label: "강의노트" }],
          },
        ],
      }),
    );

    expect(await screen.findByText("학습 자료")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "운영체제 퀴즈" })).toBeInTheDocument();
    expect(screen.getByText("난이도 medium")).toBeInTheDocument();
    expect(screen.getByText("문항 1개")).toBeInTheDocument();
    expect(screen.getByText("페이지 테이블의 역할은 무엇인가?")).toBeInTheDocument();
    expect(screen.getByText("가상 주소를 물리 주소로 매핑한다")).toBeInTheDocument();
    expect(screen.getByText("페이지 테이블은 주소 변환 정보를 담는다.")).toBeInTheDocument();
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

  it("renders PDFs with a compact material header and floating drawing tools", async () => {
    const file = fileSummary({
      title: "분석 보고서",
      filename: "analysis.pdf",
      extension: "pdf",
      kind: "pdf",
      mimeType: "application/pdf",
      ingestStatus: "completed",
    });
    renderViewer(file, "pdf");

    expect(await screen.findByTestId("agent-file-pdf-viewer")).toBeInTheDocument();
    expect(await screen.findByTestId("embedpdf-viewer")).toHaveAttribute(
      "data-src",
      `/api/agent-files/${file.id}/file`,
    );
    expect(screen.getByText("analysis.pdf")).toBeInTheDocument();
    expect(screen.getByText("분석 완료")).toHaveAttribute(
      "title",
      "이 자료는 분석되어 에이전트 질문과 노트 생성에 바로 사용할 수 있습니다.",
    );
    expect(screen.getByLabelText("PDF 그리기 도구")).toHaveClass("absolute");
    expect(screen.getByRole("button", { name: "이동" })).toHaveClass("w-8");
    expect(screen.queryByText("pdf · v3 · 2.0 KB")).not.toBeInTheDocument();
    expect(screen.queryByText("인제스트 완료")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("원본 다운로드")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("인제스트 실행")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Google Drive 연결 필요")).not.toBeInTheDocument();
    expect(pdfViewerMock.props.at(-1)?.config.i18n).toMatchObject({
      defaultLocale: "ko",
      locales: [
        {
          code: "ko",
          translations: {
            toolbar: {
              close: "닫기",
              print: "인쇄",
              protect: "보안",
              screenshot: "스크린샷",
            },
            commands: {
              zoom: {
                fitWidth: "너비에 맞춤",
              },
            },
            page: {
              next: "다음 페이지",
            },
            search: {
              placeholder: "문서에서 검색",
            },
          },
        },
      ],
    });
    expect(pdfViewerMock.props.at(-1)?.config.zoom).toMatchObject({
      defaultZoomLevel: "fit-width",
      zoomStep: 0.05,
      presets: expect.arrayContaining([
        { name: "100%", value: 1 },
        { name: "너비에 맞춤", value: "fit-width" },
      ]),
    });
  });

  it("restores and persists the EmbedPDF page for agent PDFs", async () => {
    const file = fileSummary({
      filename: "analysis.pdf",
      extension: "pdf",
      kind: "pdf",
      mimeType: "application/pdf",
    });
    const scrollToPage = vi.fn();
    const pageChange = {
      current: null as ((event: { pageNumber: number }) => void) | null,
    };
    const registry = {
      pluginsReady: vi.fn(async () => undefined),
      getCapabilityProvider: vi.fn((name: string) =>
        name === "scroll"
          ? {
              provides: () => ({
                scrollToPage,
                onPageChange: (listener: (event: { pageNumber: number }) => void) => {
                  pageChange.current = listener;
                  return vi.fn();
                },
              }),
            }
          : null,
      ),
    };
    localStorage.setItem(
      `oc:pdf-view:agent-file:${file.id}`,
      JSON.stringify({ pageNumber: 5 }),
    );

    renderViewer(file, "pdf");
    await waitFor(() => expect(pdfViewerMock.props.length).toBeGreaterThan(0));

    pdfViewerMock.props.at(-1)?.onReady?.(registry);

    await waitFor(() =>
      expect(scrollToPage).toHaveBeenCalledWith({
        pageNumber: 5,
        behavior: "instant",
      }),
    );

    pageChange.current?.({ pageNumber: 7 });
    expect(
      JSON.parse(localStorage.getItem(`oc:pdf-view:agent-file:${file.id}`) ?? "{}"),
    ).toMatchObject({ pageNumber: 7 });
  });

  it("uses compiled PDF preview for converted Office and HWP-style files", async () => {
    const file = fileSummary({
      title: "회의록",
      filename: "meeting.hwp",
      extension: "hwp",
      kind: "binary",
      mimeType: "application/x-hwp",
      ingestStatus: "completed",
      compiledMimeType: "application/pdf",
    });
    renderViewer(file, "pdf");

    expect(await screen.findByTestId("agent-file-pdf-viewer")).toBeInTheDocument();
    expect(await screen.findByTestId("embedpdf-viewer")).toHaveAttribute(
      "data-src",
      `/api/agent-files/${file.id}/compiled`,
    );
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
