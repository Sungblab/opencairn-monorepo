import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { ResearchPlanReview } from "./ResearchPlanReview";
import koMessages from "../../../messages/ko/research.json";
import { researchApi } from "@/lib/api-client-research";

vi.mock("@/lib/api-client-research", () => ({
  researchApi: {
    addTurn: vi.fn(),
    updatePlan: vi.fn(),
    approve: vi.fn(),
  },
  researchKeys: {
    all: ["research"],
    list: (w: string) => ["research", "list", w],
    detail: (r: string) => ["research", "detail", r],
  },
}));

function setup({ planText = "1) Step\n2) Step" } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="ko" messages={{ research: koMessages }}>
        <ResearchPlanReview runId="r1" planText={planText} status="awaiting_approval" />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("ResearchPlanReview", () => {
  it("renders the plan text", () => {
    setup();
    expect(screen.getByText(/1\) Step/)).toBeInTheDocument();
  });

  it("calls addTurn with feedback when sending feedback", async () => {
    vi.mocked(researchApi.addTurn).mockResolvedValueOnce({ turnId: "t" });
    setup();
    fireEvent.change(screen.getByPlaceholderText(/이 부분을 빼고/), {
      target: { value: "less depth" },
    });
    fireEvent.click(screen.getByRole("button", { name: /수정 요청/ }));
    await waitFor(() =>
      expect(researchApi.addTurn).toHaveBeenCalledWith("r1", "less depth"),
    );
  });

  it("calls approve when approving", async () => {
    vi.mocked(researchApi.approve).mockResolvedValueOnce({ approved: true });
    setup();
    fireEvent.click(screen.getByRole("button", { name: /승인하고 시작/ }));
    await waitFor(() => expect(researchApi.approve).toHaveBeenCalledWith("r1"));
  });

  it("toggles direct edit and calls updatePlan on save", async () => {
    vi.mocked(researchApi.updatePlan).mockResolvedValueOnce({ turnId: "t" });
    setup();
    fireEvent.click(screen.getByRole("button", { name: /직접 편집/ }));
    const ta = screen.getByDisplayValue(/1\) Step/);
    fireEvent.change(ta, { target: { value: "edited plan" } });
    fireEvent.click(screen.getByRole("button", { name: /수정 저장/ }));
    await waitFor(() =>
      expect(researchApi.updatePlan).toHaveBeenCalledWith("r1", "edited plan"),
    );
  });

  it("cancel reverts edit mode without calling updatePlan", () => {
    vi.mocked(researchApi.updatePlan).mockClear();
    setup();
    // Cancel only exists while editing.
    expect(
      screen.queryByRole("button", { name: /^취소$/ }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /직접 편집/ }));
    const ta = screen.getByDisplayValue(/1\) Step/);
    fireEvent.change(ta, { target: { value: "scratch text" } });

    fireEvent.click(screen.getByRole("button", { name: /^취소$/ }));

    // Back to read mode — the original plan text is shown again as a <pre>,
    // and the edit-mode textarea is gone.
    expect(screen.queryByDisplayValue("scratch text")).not.toBeInTheDocument();
    expect(screen.getByText(/1\) Step/)).toBeInTheDocument();
    expect(researchApi.updatePlan).not.toHaveBeenCalled();
  });

  it("shows iterating message during planning", () => {
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <NextIntlClientProvider locale="ko" messages={{ research: koMessages }}>
          <ResearchPlanReview runId="r1" planText="" status="planning" />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByText(/계획을 받아오는 중|계획을 다시 작성 중/)).toBeInTheDocument();
  });
});
