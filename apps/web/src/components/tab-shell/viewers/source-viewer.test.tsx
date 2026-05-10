import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Tab } from "@/stores/tabs-store";
import { useAgentWorkbenchStore } from "@/stores/agent-workbench-store";
import { usePanelStore } from "@/stores/panel-store";
import { SourceViewer } from "./source-viewer";

const pdfViewerMock = vi.hoisted(() => ({
  props: [] as Array<{
    config: { src: string };
    style?: React.CSSProperties;
    onReady?: (registry: unknown) => void;
  }>,
}));

vi.mock("@embedpdf/react-pdf-viewer", () => ({
  PDFViewer: (props: {
    config: { src: string };
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
          activity: "활동",
          analysisDescription: "현재 PDF를 중심으로 요약, 분해, 인용 추출을 시작합니다.",
          selectionTitle: "선택 영역",
          selectionEmpty: "페이지나 텍스트를 선택한 뒤 /summarize, /decompose, /cite로 이어가세요.",
          selectionActive: "{count}자 선택됨. 요약, 분해, 인용 추출로 이어갈 수 있어요.",
          useThisPdf: "이 PDF만 사용",
          summarize: "요약",
          decompose: "분해",
          citations: "인용 추출",
          review: "검토",
          activityDescription: "업로드 처리, 생성된 작업, 대기 중인 노트 변경 검토를 확인합니다.",
        },
      },
    },
  },
};

function renderSourceViewer(nextTab: Tab = tab) {
  return render(
    <NextIntlClientProvider locale="ko" messages={messages}>
      <SourceViewer tab={nextTab} />
    </NextIntlClientProvider>,
  );
}

describe("SourceViewer", () => {
  beforeEach(() => {
    pdfViewerMock.props = [];
    useAgentWorkbenchStore.setState(useAgentWorkbenchStore.getInitialState(), true);
    usePanelStore.setState(usePanelStore.getInitialState(), true);
  });

  it("loads the note file in the EmbedPDF viewer", async () => {
    renderSourceViewer();
    const viewer = await screen.findByTestId("embedpdf-viewer");

    expect(viewer).toBeInTheDocument();
    expect(viewer).toHaveAttribute("data-src", "/api/notes/n1/file");
    expect(viewer).toHaveAttribute("data-height", "100%");
  });

  it("renders nothing when targetId is null", () => {
    const { container } = renderSourceViewer({ ...tab, targetId: null });
    expect(container.firstChild).toBeNull();
  });

  it("keeps open and download actions on the raw file URL", () => {
    renderSourceViewer();

    expect(screen.getByLabelText("새 탭에서 열기")).toHaveAttribute(
      "href",
      "/api/notes/n1/file",
    );
    expect(screen.getByLabelText("새 탭에서 열기")).toHaveClass("border-border");
    expect(screen.getByLabelText("다운로드")).toHaveAttribute(
      "href",
      "/api/notes/n1/file",
    );
    expect(screen.getByLabelText("다운로드")).toHaveClass("border-border");
    expect(screen.getByLabelText("다운로드")).toHaveAttribute(
      "download",
      "doc.pdf",
    );
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
});
