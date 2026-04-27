import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { IngestSpotlight } from "./ingest-spotlight";
import { useIngestStore } from "@/stores/ingest-store";

// EventSource isn't in jsdom; the spotlight mounts useIngestStream which
// constructs one. We stub it out — the spotlight's auto-collapse logic
// reads store state directly, so the stream is irrelevant to these tests.
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
// @ts-expect-error — assign for jsdom
globalThis.EventSource = FakeEventSource;

const messages = {
  ingest: {
    spotlight: { title: "t", subtitle: "s", skipToTab: "탭에서 보기", secondsRemaining: "{n}초" },
    tab: { title: "t", openSourceNote: "o", denseToggle: "d", denseToggleOff: "do" },
    dock: { running: "r", completed: "c", failed: "f", openNote: "o", retry: "r", dismiss: "x", moreCount: "+{n}" },
    stage: { downloading: "1", parsing: "2", enhancing: "3", persisting: "4" },
    unit: { page: "p", segment: "s", section: "sec" },
    figure: { image: "i", table: "t", chart: "c", equation: "e" },
    error: { generic: "g", unsupported: "u", retryHint: "h" },
  },
};

function wrap() {
  return render(
    <NextIntlClientProvider locale="ko" messages={messages}>
      <IngestSpotlight />
    </NextIntlClientProvider>,
  );
}

describe("<IngestSpotlight>", () => {
  beforeEach(() => {
    useIngestStore.setState({ runs: {}, spotlightWfid: null });
  });
  afterEach(() => vi.useRealTimers());

  it("renders nothing when spotlightWfid is null", () => {
    wrap();
    expect(screen.queryByTestId("ingest-spotlight")).not.toBeInTheDocument();
  });

  it("renders when a run is started", () => {
    useIngestStore.getState().startRun("wf-1", "application/pdf", "x.pdf");
    wrap();
    expect(screen.getByTestId("ingest-spotlight")).toBeInTheDocument();
  });

  it("collapses when first figure arrives", async () => {
    useIngestStore.getState().startRun("wf-1", "application/pdf", "x.pdf");
    wrap();
    expect(screen.getByTestId("ingest-spotlight")).toBeInTheDocument();
    act(() => {
      useIngestStore.getState().applyEvent("wf-1", {
        workflowId: "wf-1",
        seq: 1,
        ts: "2026-04-27T00:00:00.000Z",
        kind: "figure_extracted",
        payload: {
          sourceUnit: 0,
          objectKey: "k",
          figureKind: "image",
          caption: null,
          width: 100,
          height: 100,
        },
      });
    });
    await waitFor(() =>
      expect(screen.queryByTestId("ingest-spotlight")).not.toBeInTheDocument(),
    );
  });

  it("auto-collapses after the 7s timeout", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    useIngestStore.getState().startRun("wf-1", "application/pdf", "x.pdf");
    wrap();
    expect(screen.getByTestId("ingest-spotlight")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(7100);
    });
    await waitFor(() =>
      expect(screen.queryByTestId("ingest-spotlight")).not.toBeInTheDocument(),
    );
  });

  it("skip button collapses immediately", async () => {
    useIngestStore.getState().startRun("wf-1", "application/pdf", "x.pdf");
    wrap();
    const skip = screen.getByText("탭에서 보기");
    act(() => skip.click());
    await waitFor(() =>
      expect(screen.queryByTestId("ingest-spotlight")).not.toBeInTheDocument(),
    );
  });
});
