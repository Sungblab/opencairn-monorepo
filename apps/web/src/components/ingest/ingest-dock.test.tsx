import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { IngestDock } from "./ingest-dock";
import { useIngestStore } from "@/stores/ingest-store";

class FakeEventSource {
  url: string;
  withCredentials: boolean;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(url: string, init?: { withCredentials?: boolean }) {
    this.url = url;
    this.withCredentials = init?.withCredentials ?? false;
  }
  close() {}
}
// @ts-expect-error inject for jsdom
globalThis.EventSource = FakeEventSource;

const messages = {
  ingest: {
    spotlight: { title: "t", subtitle: "s", skipToTab: "k", secondsRemaining: "{n}" },
    tab: { title: "t", openSourceNote: "o", denseToggle: "d", denseToggleOff: "do" },
    dock: {
      running: "r",
      completed: "c",
      failed: "f",
      openNote: "노트 열기",
      retry: "다시",
      dismiss: "닫기",
      moreCount: "+{n}",
    },
    stage: { downloading: "1", parsing: "2", enhancing: "3", persisting: "4" },
    unit: { page: "p", segment: "s", section: "sec" },
    figure: { image: "i", table: "t", chart: "c", equation: "e" },
    error: { generic: "g", unsupported: "u", retryHint: "h" },
  },
};

function wrap() {
  return render(
    <NextIntlClientProvider locale="ko" messages={messages}>
      <IngestDock />
    </NextIntlClientProvider>,
  );
}

describe("<IngestDock>", () => {
  beforeEach(() => {
    useIngestStore.setState({ runs: {}, spotlightWfid: null });
  });

  it("renders nothing when no runs", () => {
    const { container } = wrap();
    expect(container.firstChild).toBeNull();
  });

  it("renders one card per run, capped at 12 + overflow indicator", () => {
    for (let i = 0; i < 15; i++) {
      useIngestStore
        .getState()
        .startRun(`wf-${i}`, "application/pdf", `f${i}.pdf`);
    }
    wrap();
    expect(screen.getAllByTestId("ingest-dock-card-wrapper")).toHaveLength(12);
    expect(screen.getByText(/\+3/)).toBeInTheDocument();
  });

  it("shows openNote link for completed runs", () => {
    useIngestStore.getState().startRun("wf-1", "application/pdf", "x.pdf");
    act(() => {
      useIngestStore.getState().applyEvent("wf-1", {
        workflowId: "wf-1",
        seq: 1,
        ts: "2026-04-27T00:00:00.000Z",
        kind: "completed",
        payload: {
          noteId: "00000000-0000-0000-0000-000000000001",
          totalDurationMs: 100,
        },
      });
    });
    wrap();
    expect(screen.getByText("노트 열기")).toBeInTheDocument();
  });

  it("dismiss button removes the card from the dock", () => {
    useIngestStore.getState().startRun("wf-1", "application/pdf", "x.pdf");
    wrap();
    const dismissBtn = screen.getByLabelText("닫기");
    act(() => dismissBtn.click());
    expect(useIngestStore.getState().runs["wf-1"]).toBeUndefined();
  });

  it("failed run with retryable=true exposes retry button", () => {
    useIngestStore.getState().startRun("wf-1", "application/pdf", "x.pdf");
    act(() => {
      useIngestStore.getState().applyEvent("wf-1", {
        workflowId: "wf-1",
        seq: 1,
        ts: "2026-04-27T00:00:00.000Z",
        kind: "failed",
        payload: {
          reason: "network timeout",
          quarantineKey: null,
          retryable: true,
        },
      });
    });
    wrap();
    expect(screen.getByText("다시")).toBeInTheDocument();
  });
});
