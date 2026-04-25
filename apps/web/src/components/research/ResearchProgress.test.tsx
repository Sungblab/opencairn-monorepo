import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { ResearchProgress } from "./ResearchProgress";
import koMessages from "../../../messages/ko/research.json";
import { researchApi } from "@/lib/api-client-research";
import type { ResearchArtifact } from "@opencairn/shared";

vi.mock("@/lib/api-client-research", () => ({
  researchApi: { cancel: vi.fn() },
  researchKeys: {
    all: ["research"],
    list: (w: string) => ["research", "list", w],
    detail: (r: string) => ["research", "detail", r],
  },
}));

const sample: ResearchArtifact[] = [
  {
    id: "a1",
    seq: 0,
    kind: "thought_summary",
    payload: { text: "Considering options" },
    createdAt: "",
  },
  {
    id: "a2",
    seq: 1,
    kind: "text_delta",
    payload: { text: "Writing summary…" },
    createdAt: "",
  },
];

function setup(artifacts: ResearchArtifact[] = sample) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="ko" messages={{ research: koMessages }}>
        <ResearchProgress runId="r1" artifacts={artifacts} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("ResearchProgress", () => {
  it("renders heading + subhead", () => {
    setup();
    expect(screen.getByText(/조사 진행 중/)).toBeInTheDocument();
  });

  it("groups thought_summary vs text_delta", () => {
    setup();
    expect(screen.getByText("Considering options")).toBeInTheDocument();
    expect(screen.getByText("Writing summary…")).toBeInTheDocument();
  });

  it("shows the no-artifacts state when empty", () => {
    setup([]);
    expect(screen.getByText(/곧 결과 조각이 나타납니다/)).toBeInTheDocument();
  });

  it("calls cancel when cancel button clicked", async () => {
    vi.mocked(researchApi.cancel).mockResolvedValueOnce({ cancelled: true });
    setup();
    fireEvent.click(screen.getByRole("button", { name: /취소/ }));
    await waitFor(() => expect(researchApi.cancel).toHaveBeenCalledWith("r1"));
  });
});
