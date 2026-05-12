import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useIngestStore } from "@/stores/ingest-store";
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
      "ingest.notifications.completed": "분석이 완료되었습니다. 생성된 노트를 확인해보세요.",
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
    FakeEventSource.instances = [];
    mocks.push.mockReset();
    mocks.toastSuccess.mockReset();
    mocks.toastError.mockReset();
    // @ts-expect-error jsdom does not provide EventSource.
    globalThis.EventSource = FakeEventSource;
  });

  it("subscribes in the background and shows only a completion toast", async () => {
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
        "분석이 완료되었습니다. 생성된 노트를 확인해보세요.",
        expect.objectContaining({
          action: expect.objectContaining({ label: "확인하기" }),
        }),
      );
    });

    const options = mocks.toastSuccess.mock.calls[0]?.[1] as
      | { action?: { onClick?: () => void } }
      | undefined;
    options?.action?.onClick?.();
    expect(mocks.push).toHaveBeenCalledWith(
      "/ko/workspace/acme/note/00000000-0000-0000-0000-000000000001",
    );
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
        },
      },
    });

    render(<IngestOverlays />);

    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(FakeEventSource.instances).toHaveLength(0);
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
