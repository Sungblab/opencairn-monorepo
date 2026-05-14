import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useIngestStore } from "@/stores/ingest-store";
import { useAgentWorkbenchStore } from "@/stores/agent-workbench-store";
import { IngestOverlays } from "./ingest-overlays";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useLocale: () => "ko",
  useTranslations: (ns?: string) => {
    const messages: Record<string, string> = {
      "ingest.notifications.completed": "분석이 완료되었습니다.",
      "ingest.notifications.followUpReady": "후속 작업이 준비되었습니다.",
      "ingest.notifications.openNote": "확인하기",
      "ingest.notifications.failed": "분석에 실패했습니다.",
    };
    return (key: string) => messages[ns ? `${ns}.${key}` : key] ?? key;
  },
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ wsSlug: "acme" }),
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}));

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  withCredentials: boolean;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(url: string, init?: { withCredentials?: boolean }) {
    this.url = url;
    this.withCredentials = init?.withCredentials ?? false;
    FakeEventSource.instances.push(this);
  }

  emit(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  }

  close() {
    this.closed = true;
  }
}

describe("IngestOverlays", () => {
  beforeEach(() => {
    useIngestStore.setState({ runs: {} });
    useAgentWorkbenchStore.setState({ pendingWorkflow: null });
    FakeEventSource.instances = [];
    mocks.push.mockReset();
    mocks.toastSuccess.mockReset();
    mocks.toastError.mockReset();
    // @ts-expect-error jsdom does not provide EventSource.
    globalThis.EventSource = FakeEventSource;
  });

  it("subscribes in the background and shows only a completion toast without note navigation", async () => {
    useIngestStore.getState().startRun("wf-1", "application/pdf", "paper.pdf");

    render(<IngestOverlays />);

    expect(screen.queryByTestId("ingest-spotlight")).not.toBeInTheDocument();
    expect(screen.queryByTestId("ingest-dock")).not.toBeInTheDocument();
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0]?.url).toBe("/api/ingest/stream/wf-1");

    act(() => {
      FakeEventSource.instances[0]?.emit({
        workflowId: "wf-1",
        seq: 1,
        ts: "2026-05-12T00:00:00.000Z",
        kind: "completed",
        payload: {
          noteId: "00000000-0000-0000-0000-000000000001",
          totalDurationMs: 1000,
        },
      });
    });

    await waitFor(() => {
      expect(mocks.toastSuccess).toHaveBeenCalledWith(
        "분석이 완료되었습니다.",
      );
    });

    expect(mocks.toastSuccess.mock.calls[0]).toHaveLength(1);
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("does not replay terminal toasts for persisted historical runs", () => {
    useIngestStore.setState({
      runs: {
        "wf-old": {
          workflowId: "wf-old",
          mime: "application/pdf",
          fileName: "old.pdf",
          status: "completed",
          stage: "persisting",
          startedAt: Date.now() - 10_000,
          units: { current: 1, total: 1 },
          figures: [],
          artifacts: [],
          bundleNodeId: null,
          bundleStatus: null,
          outline: [],
          error: null,
          lastSeq: 1,
          noteId: "00000000-0000-0000-0000-000000000001",
          projectId: null,
          followUpIntent: null,
          followUpBatchId: null,
          followUpBatchSize: null,
          followUpLaunched: false,
        },
      },
    });

    render(<IngestOverlays />);

    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it("opens the selected upload follow-up when ingest completes with a note", async () => {
    useIngestStore
      .getState()
      .startRun("wf-followup", "application/pdf", "paper.pdf", {
        followUpIntent: "paper_analysis",
        projectId: "project-1",
      });

    render(<IngestOverlays />);

    act(() => {
      FakeEventSource.instances[0]?.emit({
        workflowId: "wf-followup",
        seq: 1,
        ts: "2026-05-12T00:00:00.000Z",
        kind: "completed",
        payload: {
          noteId: "00000000-0000-0000-0000-000000000101",
          totalDurationMs: 1000,
        },
      });
    });

    await waitFor(() => {
      expect(useAgentWorkbenchStore.getState().pendingWorkflow).toMatchObject({
        kind: "document_generation",
        toolId: "paper_analysis",
        payload: {
          action: "source_paper_analysis",
          sourceIds: ["note:00000000-0000-0000-0000-000000000101"],
        },
      });
    });
    expect(useIngestStore.getState().runs["wf-followup"]?.followUpLaunched).toBe(
      true,
    );
  });

  it("launches one comparison workflow after every file in the batch completes", async () => {
    useIngestStore.getState().startRun("wf-a", "application/pdf", "a.pdf", {
      followUpIntent: "comparison",
      followUpBatchId: "batch-1",
      followUpBatchSize: 2,
      projectId: "project-1",
    });
    useIngestStore.getState().startRun("wf-b", "application/pdf", "b.pdf", {
      followUpIntent: "comparison",
      followUpBatchId: "batch-1",
      followUpBatchSize: 2,
      projectId: "project-1",
    });

    render(<IngestOverlays />);

    act(() => {
      FakeEventSource.instances[0]?.emit({
        workflowId: "wf-a",
        seq: 1,
        ts: "2026-05-12T00:00:00.000Z",
        kind: "completed",
        payload: {
          noteId: "00000000-0000-0000-0000-000000000201",
          totalDurationMs: 1000,
        },
      });
    });

    expect(useAgentWorkbenchStore.getState().pendingWorkflow).toBeNull();

    act(() => {
      FakeEventSource.instances[1]?.emit({
        workflowId: "wf-b",
        seq: 1,
        ts: "2026-05-12T00:00:00.000Z",
        kind: "completed",
        payload: {
          noteId: "00000000-0000-0000-0000-000000000202",
          totalDurationMs: 1000,
        },
      });
    });

    await waitFor(() => {
      expect(useAgentWorkbenchStore.getState().pendingWorkflow).toMatchObject({
        kind: "document_generation",
        toolId: "source_comparison",
        payload: {
          action: "source_document_generation",
          sourceIds: [
            "note:00000000-0000-0000-0000-000000000201",
            "note:00000000-0000-0000-0000-000000000202",
          ],
        },
      });
    });
    expect(useIngestStore.getState().runs["wf-a"]?.followUpLaunched).toBe(true);
    expect(useIngestStore.getState().runs["wf-b"]?.followUpLaunched).toBe(true);
  });

  it("deduplicates completion toasts if overlays are mounted twice", async () => {
    useIngestStore.getState().startRun("wf-double", "application/pdf", "paper.pdf");

    render(
      <>
        <IngestOverlays />
        <IngestOverlays />
      </>,
    );

    expect(FakeEventSource.instances).toHaveLength(1);

    act(() => {
      FakeEventSource.instances[0]?.emit({
        workflowId: "wf-double",
        seq: 1,
        ts: "2026-05-12T00:00:00.000Z",
        kind: "completed",
        payload: {
          noteId: "00000000-0000-0000-0000-000000000002",
          totalDurationMs: 1000,
        },
      });
    });

    await waitFor(() => {
      expect(mocks.toastSuccess).toHaveBeenCalledTimes(1);
    });
  });
});
