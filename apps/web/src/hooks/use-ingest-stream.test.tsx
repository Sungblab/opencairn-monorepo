import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useIngestStream } from "./use-ingest-stream";

class FakeEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  static instances: FakeEventSource[] = [];
  url: string;
  withCredentials: boolean;
  readyState = FakeEventSource.OPEN;
  closed = false;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onopen: (() => void) | null = null;

  constructor(url: string, init?: { withCredentials?: boolean }) {
    this.url = url;
    this.withCredentials = init?.withCredentials ?? false;
    FakeEventSource.instances.push(this);
  }

  close() {
    this.readyState = FakeEventSource.CLOSED;
    this.closed = true;
  }
}

function Subscriber({ wfid }: { wfid: string }) {
  useIngestStream(wfid);
  return null;
}

describe("useIngestStream", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeEventSource.instances = [];
    // @ts-expect-error jsdom does not provide EventSource.
    globalThis.EventSource = FakeEventSource;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shares one EventSource per workflow across simultaneous subscribers", () => {
    const { unmount } = render(
      <>
        <Subscriber wfid="wf-1" />
        <Subscriber wfid="wf-1" />
      </>,
    );

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0]?.withCredentials).toBe(true);

    unmount();
    expect(FakeEventSource.instances[0]?.closed).toBe(true);
  });

  it("recycles a stale connecting EventSource without losing the subscriber", () => {
    const { unmount } = render(<Subscriber wfid="wf-1" />);

    const first = FakeEventSource.instances[0];
    expect(first).toBeTruthy();
    first.readyState = FakeEventSource.CONNECTING;
    first.onerror?.();

    vi.advanceTimersByTime(30_000);

    expect(first.closed).toBe(true);
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(FakeEventSource.instances[1]?.url).toBe("/api/ingest/stream/wf-1");
    expect(FakeEventSource.instances[1]?.withCredentials).toBe(true);

    unmount();
    expect(FakeEventSource.instances[1]?.closed).toBe(true);
  });
});
