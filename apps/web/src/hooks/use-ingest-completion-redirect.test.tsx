import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, act, waitFor } from "@testing-library/react";
import { useIngestStore } from "@/stores/ingest-store";
import { useIngestCompletionRedirect } from "./use-ingest-completion-redirect";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

function Probe({ wfid }: { wfid: string | null }) {
  useIngestCompletionRedirect(wfid);
  return null;
}

describe("useIngestCompletionRedirect", () => {
  beforeEach(() => {
    push.mockClear();
    useIngestStore.setState({ runs: {}, spotlightWfid: null });
  });
  afterEach(() => vi.useRealTimers());

  it("does nothing while the run is running", () => {
    vi.useFakeTimers();
    useIngestStore.getState().startRun("wf-1", "application/pdf", "x.pdf");
    render(<Probe wfid="wf-1" />);
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(push).not.toHaveBeenCalled();
  });

  it("pushes /notes/:id 5 s after completed", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    useIngestStore.getState().startRun("wf-1", "application/pdf", "x.pdf");
    render(<Probe wfid="wf-1" />);
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
    act(() => {
      vi.advanceTimersByTime(5_100);
    });
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    expect(push).toHaveBeenCalledWith(
      "/notes/00000000-0000-0000-0000-000000000001",
    );
  });

  it("cancels the redirect when the component unmounts", () => {
    vi.useFakeTimers();
    useIngestStore.getState().startRun("wf-1", "application/pdf", "x.pdf");
    const { unmount } = render(<Probe wfid="wf-1" />);
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
    unmount();
    act(() => {
      vi.advanceTimersByTime(5_100);
    });
    expect(push).not.toHaveBeenCalled();
  });

  it("does nothing when enabled is false", () => {
    vi.useFakeTimers();
    function Probe2({ wfid }: { wfid: string | null }) {
      useIngestCompletionRedirect(wfid, { enabled: false });
      return null;
    }
    useIngestStore.getState().startRun("wf-1", "application/pdf", "x.pdf");
    render(<Probe2 wfid="wf-1" />);
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
      vi.advanceTimersByTime(5_100);
    });
    expect(push).not.toHaveBeenCalled();
  });
});
