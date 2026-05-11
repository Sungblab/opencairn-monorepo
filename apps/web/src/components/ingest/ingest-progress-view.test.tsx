import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { IngestProgressView } from "./ingest-progress-view";
import { useIngestStore } from "@/stores/ingest-store";

const messages = {
  ingest: {
    tab: {
      title: "분석 중: {fileName}",
      openSourceNote: "노트로 이동",
      denseToggle: "상세 보기",
      denseToggleOff: "간단히 보기",
    },
    stage: {
      downloading: "다운로드 중",
      parsing: "파싱 중",
      enhancing: "개선 중",
      persisting: "저장 중",
    },
    pipeline: {
      title: "처리 과정",
      current: "진행 중",
      done: "완료",
      waiting: "대기",
      failed: "실패",
      downloading: {
        title: "PDF 업로드",
        description: "원본 파일을 안전하게 저장합니다.",
      },
      parsing: {
        title: "PDF 파싱",
        description: "텍스트와 페이지 구조를 읽습니다.",
      },
      markdown: {
        title: "Markdown 분리",
        description: "페이지별 Markdown 결과를 만듭니다.",
      },
      figures: {
        title: "이미지·도표 추출",
        description: "문서 안의 시각 자료를 분리합니다.",
      },
      enhancing: {
        title: "AI 분석",
        description: "요약, 개념, 문제 후보를 만듭니다.",
      },
      persisting: {
        title: "프로젝트에 저장",
        description: "노트와 아티팩트를 트리에 연결합니다.",
      },
      emptyArtifacts: "아직 생성된 산출물이 없습니다.",
      bundleRunning: "프로젝트 트리에 생성 중",
      bundleCompleted: "프로젝트 트리에 저장 완료",
      bundleFailed: "프로젝트 트리 저장 실패",
      sourceNoteLabel: "AI 정리 노트",
    },
    artifactRole: {
      parsed: "Markdown",
      parsed_page: "페이지 Markdown",
      figure: "이미지·도표",
      source_note: "AI 정리 노트",
      analysis: "AI 분석",
      other: "산출물",
    },
    unit: { page: "p", segment: "s", section: "sec" },
    figure: { image: "이미지", table: "표", chart: "차트", equation: "수식" },
    error: { generic: "g", unsupported: "u", retryHint: "h" },
  },
};

function wrap(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="ko" messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("<IngestProgressView>", () => {
  beforeEach(() => {
    useIngestStore.setState({ runs: {} });
  });

  it("renders nothing when no run exists", () => {
    const { container } = wrap(
      <IngestProgressView wfid="absent" mode="tab" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders fileName when run exists", () => {
    useIngestStore.getState().startRun("wf-1", "application/pdf", "paper.pdf");
    wrap(<IngestProgressView wfid="wf-1" mode="tab" />);
    expect(screen.getByText(/paper\.pdf/)).toBeInTheDocument();
  });

  it("renders figure count after a figure_extracted event", () => {
    useIngestStore.getState().startRun("wf-1", "application/pdf", "paper.pdf");
    useIngestStore.getState().applyEvent("wf-1", {
      workflowId: "wf-1",
      seq: 1,
      ts: "2026-04-27T00:00:00.000Z",
      kind: "figure_extracted",
      payload: {
        sourceUnit: 0,
        objectKey: "uploads/u/figures/wf-1/p0-f0.png",
        figureKind: "image",
        caption: null,
        width: 100,
        height: 100,
      },
    });
    wrap(<IngestProgressView wfid="wf-1" mode="tab" />);
    const counts = screen.getAllByTestId("figure-count");
    expect(counts[0]).toHaveTextContent("1");
  });

  it("tab mode shows the current stage label when set", () => {
    useIngestStore.getState().startRun("wf-1", "application/pdf", "paper.pdf");
    useIngestStore.getState().applyEvent("wf-1", {
      workflowId: "wf-1",
      seq: 1,
      ts: "2026-04-27T00:00:00.000Z",
      kind: "stage_changed",
      payload: { stage: "enhancing", pct: null },
    });
    wrap(<IngestProgressView wfid="wf-1" mode="tab" />);
    expect(screen.getByText("개선 중")).toBeInTheDocument();
  });

  it("visualizes the PDF ingest pipeline with current and completed stages", () => {
    useIngestStore.getState().startRun("wf-1", "application/pdf", "paper.pdf");
    useIngestStore.getState().applyEvent("wf-1", {
      workflowId: "wf-1",
      seq: 1,
      ts: "2026-04-27T00:00:00.000Z",
      kind: "stage_changed",
      payload: { stage: "enhancing", pct: null },
    });
    useIngestStore.getState().applyEvent("wf-1", {
      workflowId: "wf-1",
      seq: 2,
      ts: "2026-04-27T00:00:00.000Z",
      kind: "artifact_created",
      payload: {
        nodeId: "00000000-0000-0000-0000-000000000010",
        parentId: "00000000-0000-0000-0000-000000000011",
        kind: "agent_file",
        label: "parsed.md",
        role: "parsed",
      },
    });
    useIngestStore.getState().applyEvent("wf-1", {
      workflowId: "wf-1",
      seq: 3,
      ts: "2026-04-27T00:00:00.000Z",
      kind: "artifact_created",
      payload: {
        nodeId: "00000000-0000-0000-0000-000000000012",
        parentId: "00000000-0000-0000-0000-000000000011",
        kind: "agent_file",
        label: "page-001.md",
        role: "parsed_page",
        pageIndex: 0,
      },
    });
    useIngestStore.getState().applyEvent("wf-1", {
      workflowId: "wf-1",
      seq: 4,
      ts: "2026-04-27T00:00:00.000Z",
      kind: "artifact_created",
      payload: {
        nodeId: "00000000-0000-0000-0000-000000000013",
        parentId: "00000000-0000-0000-0000-000000000014",
        kind: "artifact",
        label: "figure-001.png",
        role: "figure",
        pageIndex: 0,
        figureIndex: 0,
      },
    });

    wrap(<IngestProgressView wfid="wf-1" mode="tab" />);

    expect(screen.getByText("처리 과정")).toBeInTheDocument();
    expect(screen.getByTestId("ingest-pipeline-step-downloading")).toHaveAttribute(
      "data-state",
      "done",
    );
    expect(screen.getByTestId("ingest-pipeline-step-enhancing")).toHaveAttribute(
      "data-state",
      "current",
    );
    expect(screen.getByText("Markdown 분리")).toBeInTheDocument();
    expect(screen.getByText("parsed.md")).toBeInTheDocument();
    expect(screen.getByText("page-001.md")).toBeInTheDocument();
    expect(screen.getByText("figure-001.png")).toBeInTheDocument();
  });

  it("shows bundle persistence status and completed AI note in the pipeline", () => {
    useIngestStore.getState().startRun("wf-1", "application/pdf", "paper.pdf");
    useIngestStore.getState().applyEvent("wf-1", {
      workflowId: "wf-1",
      seq: 1,
      ts: "2026-04-27T00:00:00.000Z",
      kind: "bundle_status_changed",
      payload: {
        bundleNodeId: "00000000-0000-0000-0000-000000000020",
        status: "completed",
      },
    });
    useIngestStore.getState().applyEvent("wf-1", {
      workflowId: "wf-1",
      seq: 2,
      ts: "2026-04-27T00:00:00.000Z",
      kind: "completed",
      payload: {
        noteId: "00000000-0000-0000-0000-000000000021",
        totalDurationMs: 7000,
      },
    });

    wrap(<IngestProgressView wfid="wf-1" mode="tab" />);

    expect(screen.getByText("프로젝트 트리에 저장 완료")).toBeInTheDocument();
    expect(screen.getAllByText("AI 정리 노트").length).toBeGreaterThan(0);
    expect(screen.getByTestId("ingest-pipeline-step-persisting")).toHaveAttribute(
      "data-state",
      "done",
    );
  });

  it("marks the persistence step failed when source bundle storage fails", () => {
    useIngestStore.getState().startRun("wf-1", "application/pdf", "paper.pdf");
    useIngestStore.getState().applyEvent("wf-1", {
      workflowId: "wf-1",
      seq: 1,
      ts: "2026-04-27T00:00:00.000Z",
      kind: "bundle_status_changed",
      payload: {
        bundleNodeId: "00000000-0000-0000-0000-000000000020",
        status: "failed",
        reason: "tree callback failed",
      },
    });

    wrap(<IngestProgressView wfid="wf-1" mode="tab" />);

    expect(screen.getByText("프로젝트 트리 저장 실패")).toBeInTheDocument();
    expect(screen.getByTestId("ingest-pipeline-step-persisting")).toHaveAttribute(
      "data-state",
      "failed",
    );
  });

  it("marks upload as failed when a run fails before any stage is known", () => {
    useIngestStore.getState().startRun("wf-1", "application/pdf", "paper.pdf");
    useIngestStore.getState().applyEvent("wf-1", {
      workflowId: "wf-1",
      seq: 1,
      ts: "2026-04-27T00:00:00.000Z",
      kind: "failed",
      payload: {
        reason: "worker failed before start",
        quarantineKey: null,
        retryable: true,
      },
    });

    wrap(<IngestProgressView wfid="wf-1" mode="tab" />);

    expect(screen.getByTestId("ingest-pipeline-step-downloading")).toHaveAttribute(
      "data-state",
      "failed",
    );
    expect(screen.getByTestId("ingest-pipeline-step-persisting")).toHaveAttribute(
      "data-state",
      "waiting",
    );
  });
});
