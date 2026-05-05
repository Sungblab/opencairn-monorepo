import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { JobProgress } from "./JobProgress";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

const messages = {
  import: {
    actions: {
      cancel: "취소",
      cancelling: "취소 중...",
      retry: "재시도",
      retrying: "재시도 중...",
      openResult: "결과 열기",
    },
    progress: {
      summary: "{completed} / {total} · 실패 {failed}",
      completed: "완료되었습니다.",
      failed: "가져오기에 실패했습니다.",
    },
    errors: {
      retryFailed: "재시도를 시작하지 못했습니다.",
      cancelFailed: "취소하지 못했습니다.",
    },
  },
};

class MockEventSource {
  static instances: MockEventSource[] = [];
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();

  constructor(public readonly url: string) {
    MockEventSource.instances.push(this);
  }
}

function renderProgress() {
  return render(
    <NextIntlClientProvider locale="ko" messages={messages}>
      <JobProgress wsSlug="acme" jobId="job-1" />
    </NextIntlClientProvider>,
  );
}

describe("JobProgress", () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    vi.stubGlobal("EventSource", MockEventSource);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: true }))),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("cancels a queued import job through the import job API", async () => {
    renderProgress();

    expect(MockEventSource.instances[0]?.url).toBe("/api/import/jobs/job-1/events");
    fireEvent.click(screen.getByRole("button", { name: "취소" }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith("/api/import/jobs/job-1", {
        method: "DELETE",
        credentials: "include",
      });
    });
    expect(await screen.findByText("가져오기에 실패했습니다.")).toBeInTheDocument();
  });
});
