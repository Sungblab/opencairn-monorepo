import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { IngestProgressView } from "./ingest-progress-view";
import { useIngestStore } from "@/stores/ingest-store";

const messages = {
  ingest: {
    spotlight: {
      title: "{fileName} 분석 중",
      subtitle: "...",
      skipToTab: "탭에서 보기",
      secondsRemaining: "{n}초",
    },
    tab: {
      title: "분석 중: {fileName}",
      openSourceNote: "노트로 이동",
      denseToggle: "상세 보기",
      denseToggleOff: "간단히 보기",
    },
    dock: {
      running: "{fileName} · {pct}%",
      completed: "{fileName} 완료",
      failed: "{fileName} 실패",
      openNote: "노트 열기",
      retry: "다시 시도",
      dismiss: "닫기",
      moreCount: "+{n}개 더",
    },
    stage: {
      downloading: "다운로드 중",
      parsing: "파싱 중",
      enhancing: "개선 중",
      persisting: "저장 중",
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
    useIngestStore.setState({ runs: {}, spotlightWfid: null });
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

  it("dock mode renders the dock card with progress", () => {
    useIngestStore.getState().startRun("wf-1", "application/pdf", "paper.pdf");
    wrap(<IngestProgressView wfid="wf-1" mode="dock" />);
    expect(screen.getByTestId("ingest-dock-card")).toBeInTheDocument();
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
});
