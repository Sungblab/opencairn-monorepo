import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Tab } from "@/stores/tabs-store";
import { useAgentWorkbenchStore } from "@/stores/agent-workbench-store";
import { usePanelStore } from "@/stores/panel-store";
import { SourceViewer } from "./source-viewer";

const pdfViewerMock = vi.hoisted(() => ({
  props: [] as Array<{
    config: {
      src: string;
      zoom?: {
        defaultZoomLevel?: string | number;
        zoomStep?: number;
        presets?: Array<{ name: string; value: string | number }>;
      };
      disabledCategories?: string[];
      i18n?: {
        defaultLocale?: string;
        locales?: Array<{
          code: string;
          translations: {
            toolbar?: {
              open?: string;
              export?: string;
              fullscreen?: string;
            };
            document?: {
              open?: string;
              close?: string;
              print?: string;
              export?: string;
              fullscreen?: string;
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
      disabledCategories?: string[];
      i18n?: {
        defaultLocale?: string;
        locales?: Array<{
          code: string;
          translations: {
            toolbar?: {
              open?: string;
              export?: string;
              fullscreen?: string;
            };
            document?: {
              open?: string;
              close?: string;
              print?: string;
              export?: string;
              fullscreen?: string;
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

vi.mock("@/components/sidebar/use-current-project", () => ({
  useCurrentProjectContext: () => ({
    wsSlug: "acme",
    projectId: "proj-1",
    routeProjectId: "proj-1",
  }),
}));

vi.mock("@/components/agent-panel/note-update-action-review", () => ({
  NoteUpdateActionReviewList: ({ projectId }: { projectId: string | null }) => (
    <div data-testid="note-update-review-list" data-project-id={projectId ?? ""} />
  ),
}));

vi.mock("@/components/agent-panel/workbench-activity-stack", () => ({
  WorkbenchActivityStack: () => <div data-testid="workbench-activity-stack" />,
}));

const tab: Tab = {
  id: "t",
  kind: "note" as const,
  targetId: "n1",
  mode: "source" as const,
  title: "doc.pdf",
  titleKey: undefined,
  titleParams: undefined,
  pinned: false,
  preview: false,
  dirty: false,
  splitWith: null,
  splitSide: null as "left" | "right" | null,
  scrollY: 0,
};

const messages = {
  appShell: {
    viewers: {
      source: {
        title: "원본 PDF",
        frameTitle: "{title} PDF 뷰어",
        open: "새 탭에서 열기",
        download: "다운로드",
        rail: {
          title: "PDF 작업 패널",
          close: "닫기",
          analysis: "분석",
          wiki: "위키",
          activity: "활동",
          study: "학습",
          analysisDescription: "현재 PDF를 중심으로 요약, 분해, 인용 추출을 시작합니다.",
          wikiDescription: "이 PDF에서 이어진 위키 노트와 프로젝트 개념 지도를 확인합니다.",
          wikiBacklinksTitle: "연결된 노트",
          wikiBacklinksEmpty: "아직 이 PDF로 돌아오는 위키 링크가 없습니다.",
          wikiGraphTitle: "프로젝트 지식맵",
          wikiGraphSummary: "개념 {count}개 · 관계 {edgeCount}개",
          wikiGraphOpen: "그래프 열기",
          wikiConceptsTitle: "주요 개념",
          wikiConceptsEmpty: "인제스트가 끝나면 주요 개념이 여기에 표시됩니다.",
          selectionTitle: "선택 영역",
          selectionEmpty: "페이지나 텍스트를 선택한 뒤 /summarize, /decompose, /cite로 이어가세요.",
          selectionActive: "{count}자 선택됨. 요약, 분해, 인용 추출로 이어갈 수 있어요.",
          useThisPdf: "이 PDF만 사용",
          summarize: "요약",
          decompose: "분해",
          citations: "인용 추출",
          review: "검토",
          activityDescription: "업로드 처리, 생성된 작업, 대기 중인 노트 변경 검토를 확인합니다.",
          studyDescription: "이 PDF를 수업이나 논문 읽기 세션으로 묶어 녹음, 전사, 노트를 이어갑니다.",
          createStudySession: "학습 세션 만들기",
          creatingStudySession: "세션 생성 중",
          sessionReady: "세션 준비됨",
          transcriptReady: "전사 {count}개 구간 준비됨",
          transcriptPending: "녹음 전사 대기 중",
          noRecording: "아직 연결된 녹음이 없습니다.",
          recordingTitle: "녹음",
          recordingDuration: "{duration}",
          recordingIdle: "마이크 녹음을 시작할 수 있습니다.",
          recordingUploading: "업로드 중",
          recordingProcessing: "처리 중",
          recordingCompleted: "재생 가능한 녹음 {count}개",
          recordingUnsupported: "이 브라우저에서는 녹음을 사용할 수 없습니다.",
          recordingPermissionFailed: "마이크 권한을 얻지 못했습니다.",
          recordingUploadFailed: "녹음 업로드에 실패했습니다.",
          recordingEmpty: "비어 있는 녹음은 업로드하지 않았습니다.",
          startRecording: "시작",
          stopRecording: "정지",
          recordingsTitle: "녹음 목록",
          recordingUnknownDuration: "길이 미확인",
          recordingFailed: "실패",
          recordingReady: "완료",
          recordingUploaded: "업로드됨",
          playbackTitle: "재생",
          play: "재생",
          playing: "선택됨",
          transcriptTitle: "전사",
          transcriptProcessing: "전사 생성 중",
          transcriptFailed: "전사를 만들지 못했습니다.",
          transcriptEmpty: "아직 표시할 전사 구간이 없습니다.",
        },
      },
    },
  },
};

function renderSourceViewer(nextTab: Tab = tab) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider locale="ko" messages={messages}>
        <SourceViewer tab={nextTab} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("SourceViewer", () => {
  beforeEach(() => {
    pdfViewerMock.props = [];
    localStorage.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (
          url ===
          "/api/projects/proj-1/study-sessions?sourceNoteId=n1"
        ) {
          return new Response(JSON.stringify({ sessions: [] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url === "/api/study-sessions" && init?.method === "POST") {
          return new Response(
            JSON.stringify({
              session: {
                id: "session-1",
                workspaceId: "workspace-1",
                projectId: "proj-1",
                title: "doc.pdf",
                status: "active",
                startedAt: "2026-05-12T00:00:00.000Z",
                endedAt: null,
                createdBy: "user-1",
                createdAt: "2026-05-12T00:00:00.000Z",
                updatedAt: "2026-05-12T00:00:00.000Z",
                sources: [],
              },
            }),
            {
              status: 201,
              headers: { "content-type": "application/json" },
            },
          );
        }
        return new Response(JSON.stringify({ error: "not_found" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    useAgentWorkbenchStore.setState(useAgentWorkbenchStore.getInitialState(), true);
    usePanelStore.setState(usePanelStore.getInitialState(), true);
  });

  it("loads the note file in the EmbedPDF viewer", async () => {
    renderSourceViewer();
    const viewer = await screen.findByTestId("embedpdf-viewer");

    expect(viewer).toBeInTheDocument();
    expect(viewer).toHaveAttribute("data-src", "/api/notes/n1/file");
    expect(viewer).toHaveAttribute("data-height", "100%");
    expect(pdfViewerMock.props.at(-1)?.config.zoom).toMatchObject({
      defaultZoomLevel: "fit-width",
      zoomStep: 0.05,
      presets: expect.arrayContaining([
        { name: "100%", value: 1 },
        { name: "너비에 맞춤", value: "fit-width" },
      ]),
    });
    expect(pdfViewerMock.props.at(-1)?.config.disabledCategories).toContain(
      "annotation",
    );
    expect(pdfViewerMock.props.at(-1)?.config.i18n).toMatchObject({
      defaultLocale: "ko",
      locales: [
        {
          code: "ko",
          translations: {
            toolbar: {
              open: "열기",
              export: "내보내기",
              fullscreen: "전체 화면",
            },
            document: {
              open: "열기",
              close: "닫기",
              print: "인쇄",
              export: "내보내기",
              fullscreen: "전체 화면",
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
  });

  it("renders nothing when targetId is null", () => {
    const { container } = renderSourceViewer({ ...tab, targetId: null });
    expect(container.firstChild).toBeNull();
  });

  it("does not render a second file header above the PDF toolbar", async () => {
    renderSourceViewer();
    await screen.findByTestId("embedpdf-viewer");

    expect(screen.queryByLabelText("새 탭에서 열기")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("다운로드")).not.toBeInTheDocument();
  });

  it("emits a viewer-ready event for agent integrations", async () => {
    const listener = vi.fn();
    window.addEventListener("opencairn:source-pdf-ready", listener);

    renderSourceViewer();
    await waitFor(() => expect(pdfViewerMock.props.length).toBeGreaterThan(0));

    act(() => {
      pdfViewerMock.props.at(-1)?.onReady?.({ search: "registry" });
    });

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0]?.[0] as CustomEvent;
    expect(event.detail).toMatchObject({
      tabId: "t",
      noteId: "n1",
      title: "doc.pdf",
    });
    expect(event.detail.registry).toEqual({ search: "registry" });

    window.removeEventListener("opencairn:source-pdf-ready", listener);
  });

  it("restores and persists the EmbedPDF page for source PDFs", async () => {
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
      "oc:pdf-view:source:n1",
      JSON.stringify({ pageNumber: 4 }),
    );

    renderSourceViewer();
    await waitFor(() => expect(pdfViewerMock.props.length).toBeGreaterThan(0));

    act(() => {
      pdfViewerMock.props.at(-1)?.onReady?.(registry);
    });

    await waitFor(() =>
      expect(scrollToPage).toHaveBeenCalledWith({
        pageNumber: 4,
        behavior: "instant",
      }),
    );

    pageChange.current?.({ pageNumber: 9 });
    expect(
      JSON.parse(localStorage.getItem("oc:pdf-view:source:n1") ?? "{}"),
    ).toMatchObject({ pageNumber: 9 });
  });

  it("renders a PDF contextual rail next to the central viewer", async () => {
    renderSourceViewer();
    await screen.findByTestId("embedpdf-viewer");

    expect(screen.getByTestId("source-context-rail")).toBeInTheDocument();
    expect(screen.getByTestId("source-context-rail")).toHaveClass(
      "border-border",
    );
    expect(screen.getByTestId("source-context-rail-panel")).toHaveClass(
      "flex",
      "flex-col",
      "min-h-0",
    );
    expect(screen.getByTestId("source-context-rail-scroll")).toHaveClass(
      "overflow-y-auto",
    );
    expect(
      screen.getByRole("button", { name: "분석" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("선택 영역")).toBeInTheDocument();
    expect(
      screen.getByTestId("source-rail-summarize-button"),
    ).toHaveTextContent("요약");
  });

  it("starts PDF analysis from the source rail through the right workbench", async () => {
    renderSourceViewer();
    await screen.findByTestId("embedpdf-viewer");

    await userEvent.click(screen.getByTestId("source-rail-summarize-button"));

    expect(usePanelStore.getState()).toMatchObject({
      agentPanelOpen: true,
      agentPanelTab: "chat",
    });
    expect(useAgentWorkbenchStore.getState().pendingIntent).toMatchObject({
      kind: "runCommand",
      commandId: "summarize",
    });
  });

  it("surfaces wiki notes and project graph context from the source rail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/notes/n1/backlinks") {
          return jsonResponse({
            total: 1,
            data: [
              {
                id: "11111111-1111-4111-8111-111111111111",
                title: "소프트웨어 개념 정리",
                projectId: "proj-1",
                projectName: "First Project",
                updatedAt: "2026-05-12T00:00:00.000Z",
              },
            ],
          });
        }
        if (
          url ===
          "/api/projects/proj-1/knowledge-surface?view=cards&includeEvidence=true"
        ) {
          return jsonResponse({
            viewType: "cards",
            layout: "preset",
            rootId: null,
            truncated: false,
            totalConcepts: 2,
            nodes: [
              {
                id: "22222222-2222-4222-8222-222222222222",
                name: "소프트웨어",
                description: "명령과 데이터로 컴퓨터 동작을 정의하는 개념",
                degree: 3,
                noteCount: 2,
                firstNoteId: "11111111-1111-4111-8111-111111111111",
              },
              {
                id: "33333333-3333-4333-8333-333333333333",
                name: "하드웨어",
                degree: 1,
                noteCount: 1,
                firstNoteId: null,
              },
            ],
            edges: [
              {
                id: "edge-1",
                sourceId: "22222222-2222-4222-8222-222222222222",
                targetId: "33333333-3333-4333-8333-333333333333",
                relationType: "contrast",
                weight: 0.8,
                surfaceType: "semantic_relation",
                displayOnly: false,
                sourceNoteIds: [],
              },
            ],
          });
        }
        if (url === "/api/projects/proj-1/study-sessions?sourceNoteId=n1") {
          return jsonResponse({ sessions: [] });
        }
        return jsonResponse({ error: "not_found" }, 404);
      }),
    );

    renderSourceViewer();
    await screen.findByTestId("embedpdf-viewer");

    await userEvent.click(screen.getByRole("button", { name: "위키" }));

    expect(await screen.findByText("소프트웨어 개념 정리")).toBeInTheDocument();
    expect(screen.getByText("프로젝트 지식맵")).toBeInTheDocument();
    expect(screen.getByText("개념 2개 · 관계 1개")).toBeInTheDocument();
    expect(screen.getByText("소프트웨어")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "그래프 열기" })).toHaveAttribute(
      "href",
      "/ko/workspace/acme/project/proj-1/graph?view=cards",
    );
  });

  it("reflects text selected inside the PDF area in the source rail", async () => {
    renderSourceViewer();
    await screen.findByTestId("embedpdf-viewer");

    const area = screen.getByTestId("source-pdf-area");
    const selected = document.createTextNode("선택된 문장");
    area.appendChild(selected);
    const range = document.createRange();
    range.selectNodeContents(selected);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    document.dispatchEvent(new Event("selectionchange"));

    expect(await screen.findByText("선택된 문장")).toBeInTheDocument();
    expect(screen.getByText(/6자 선택됨/)).toBeInTheDocument();
  });

  it("connects source activity to ingest progress and pending note update review", async () => {
    renderSourceViewer();
    await screen.findByTestId("embedpdf-viewer");

    await userEvent.click(screen.getByRole("button", { name: "활동" }));

    expect(screen.getByTestId("workbench-activity-stack")).toBeInTheDocument();
    expect(screen.getByTestId("note-update-review-list")).toHaveAttribute(
      "data-project-id",
      "proj-1",
    );
  });

  it("creates a source-scoped study session from the rail", async () => {
    renderSourceViewer();
    await screen.findByTestId("embedpdf-viewer");

    await userEvent.click(screen.getByRole("button", { name: "학습" }));
    expect(
      await screen.findByText("아직 연결된 녹음이 없습니다."),
    ).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: "학습 세션 만들기" }),
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/study-sessions",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            projectId: "proj-1",
            sourceNoteId: "n1",
            title: "doc.pdf",
          }),
        }),
      );
    });
  });

  it("records audio from the Study rail and uploads it with duration", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/projects/proj-1/study-sessions?sourceNoteId=n1") {
        return jsonResponse({
          sessions: [studySession()],
        });
      }
      if (url === "/api/study-sessions/session-1/recordings") {
        return jsonResponse({ recordings: [] });
      }
      if (url === "/api/study-sessions/session-1/transcript") {
        return jsonResponse({ sessionId: "session-1", text: "", segments: [] });
      }
      if (
        url === "/api/study-sessions/session-1/recordings/upload"
        && init?.method === "POST"
      ) {
        return jsonResponse({
          recording: recording({ status: "processing", transcriptStatus: "processing" }),
          workflowId: "study-session-recording/rec-1",
        }, 202);
      }
      return jsonResponse({ error: "not_found" }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);
    const stopTrack = vi.fn();
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: vi.fn(async () => ({
          getTracks: () => [{ stop: stopTrack }],
        })),
      },
    });
    class MockMediaRecorder {
      static isTypeSupported = () => true;
      state: RecordingState = "inactive";
      mimeType = "audio/webm";
      ondataavailable: ((event: BlobEvent) => void) | null = null;
      onstop: (() => void) | null = null;
      constructor(
        _stream: MediaStream,
        options?: MediaRecorderOptions,
      ) {
        this.mimeType = options?.mimeType ?? "audio/webm";
      }
      start() {
        this.state = "recording";
      }
      stop() {
        this.state = "inactive";
        this.ondataavailable?.({ data: new Blob(["audio"], { type: this.mimeType }) } as BlobEvent);
        this.onstop?.();
      }
    }
    vi.stubGlobal("MediaRecorder", MockMediaRecorder);

    renderSourceViewer();
    await userEvent.click(await screen.findByRole("button", { name: "학습" }));
    await screen.findByText("마이크 녹음을 시작할 수 있습니다.");

    await userEvent.click(screen.getByRole("button", { name: "시작" }));
    await userEvent.click(screen.getByRole("button", { name: "정지" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/study-sessions/session-1/recordings/upload",
        expect.objectContaining({ method: "POST" }),
      );
    });
    const uploadCall = fetchMock.mock.calls.find(
      ([url]) => String(url) === "/api/study-sessions/session-1/recordings/upload",
    );
    const form = uploadCall?.[1]?.body as FormData;
    expect(form.get("durationSec")).toBeTruthy();
    expect(form.get("file")).toBeInstanceOf(File);
    expect(stopTrack).toHaveBeenCalled();
  });

  it("shows completed playback and seeks audio from transcript segments", async () => {
    const play = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      value: play,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/projects/proj-1/study-sessions?sourceNoteId=n1") {
          return jsonResponse({ sessions: [studySession()] });
        }
        if (url === "/api/study-sessions/session-1/recordings") {
          return jsonResponse({
            recordings: [recording({ status: "ready", transcriptStatus: "ready" })],
          });
        }
        if (url === "/api/study-sessions/session-1/transcript") {
          return jsonResponse({
            sessionId: "session-1",
            text: "핵심 개념",
            segments: [
              {
                id: "seg-1",
                recordingId: "rec-1",
                index: 0,
                startSec: 2,
                endSec: 5,
                text: "핵심 개념",
                speaker: null,
                language: "ko",
                confidence: null,
                createdAt: "2026-05-12T00:00:00.000Z",
              },
            ],
          });
        }
        return jsonResponse({ error: "not_found" }, 404);
      }),
    );

    renderSourceViewer();
    await userEvent.click(await screen.findByRole("button", { name: "학습" }));

    expect(await screen.findByText("핵심 개념")).toBeInTheDocument();
    expect(screen.getByText("0:02 - 0:05")).toBeInTheDocument();
    expect(screen.getByText("재생 가능한 녹음 1개")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "선택됨" })).toBeInTheDocument();
    expect(screen.getByTestId("study-recording-audio")).toHaveAttribute(
      "src",
      "/api/study-sessions/session-1/recordings/rec-1/file",
    );

    await userEvent.click(screen.getByText("핵심 개념"));

    await waitFor(() => expect(play).toHaveBeenCalled());
  });
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function studySession() {
  return {
    id: "session-1",
    workspaceId: "workspace-1",
    projectId: "proj-1",
    title: "doc.pdf",
    status: "active",
    startedAt: "2026-05-12T00:00:00.000Z",
    endedAt: null,
    createdBy: "user-1",
    createdAt: "2026-05-12T00:00:00.000Z",
    updatedAt: "2026-05-12T00:00:00.000Z",
    sources: [],
  };
}

function recording(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "rec-1",
    sessionId: "session-1",
    objectKey: "study-sessions/session-1/recordings/user/rec.webm",
    mimeType: "audio/webm",
    durationSec: 5,
    status: "ready",
    transcriptStatus: "ready",
    createdBy: "user-1",
    createdAt: "2026-05-12T00:00:00.000Z",
    updatedAt: "2026-05-12T00:00:00.000Z",
    ...overrides,
  };
}
