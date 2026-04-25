import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { ResearchRunView } from "./ResearchRunView";
import koMessages from "../../../messages/ko/research.json";
import { researchApi } from "@/lib/api-client-research";
import type { ResearchRunDetail } from "@opencairn/shared";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: pushMock }),
}));

vi.mock("@/lib/api-client-research", () => ({
  researchApi: {
    getRun: vi.fn(),
    addTurn: vi.fn(),
    updatePlan: vi.fn(),
    approve: vi.fn(),
    cancel: vi.fn(),
  },
  researchKeys: {
    all: ["research"],
    list: (w: string) => ["research", "list", w],
    detail: (r: string) => ["research", "detail", r],
  },
}));

vi.mock("@/hooks/use-research-stream", () => ({
  useResearchStream: vi.fn(),
}));

function detail(over: Partial<ResearchRunDetail>): ResearchRunDetail {
  return {
    id: "r1",
    workspaceId: "w1",
    projectId: "p1",
    topic: "T",
    model: "deep-research-preview-04-2026",
    status: "planning",
    billingPath: "byok",
    currentInteractionId: null,
    approvedPlanText: null,
    error: null,
    totalCostUsdCents: null,
    noteId: null,
    createdAt: "2026-04-25T00:00:00Z",
    updatedAt: "2026-04-25T00:00:00Z",
    completedAt: null,
    turns: [],
    artifacts: [],
    ...over,
  };
}

function setup(d: ResearchRunDetail) {
  vi.mocked(researchApi.getRun).mockResolvedValueOnce(d);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="ko" messages={{ research: koMessages }}>
        <ResearchRunView runId="r1" wsSlug="acme" />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("ResearchRunView", () => {
  beforeEach(() => {
    pushMock.mockClear();
  });

  it("renders ResearchPlanReview when awaiting_approval", async () => {
    setup(
      detail({
        status: "awaiting_approval",
        turns: [
          {
            id: "t",
            seq: 0,
            role: "agent",
            kind: "plan_proposal",
            interactionId: null,
            content: "Plan body",
            createdAt: "",
          },
        ],
      }),
    );
    await waitFor(() =>
      expect(screen.getByText(/조사 계획 검토/)).toBeInTheDocument(),
    );
    expect(screen.getByText(/Plan body/)).toBeInTheDocument();
  });

  it("renders ResearchProgress when researching", async () => {
    setup(detail({ status: "researching" }));
    await waitFor(() =>
      expect(screen.getByText(/조사 진행 중/)).toBeInTheDocument(),
    );
  });

  it("redirects to the note when completed and noteId set", async () => {
    setup(detail({ status: "completed", noteId: "n1" }));
    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith(
        expect.stringMatching(/\/app\/w\/acme\/n\/n1$/),
      );
    });
  });

  it("renders failure state when failed", async () => {
    setup(
      detail({
        status: "failed",
        error: { code: "invalid_byok_key", message: "x", retryable: false },
      }),
    );
    await waitFor(() =>
      expect(
        screen.getByText(/Gemini API 키가 유효하지 않습니다/),
      ).toBeInTheDocument(),
    );
  });

  it("renders managed_credits_short copy + billing CTA", async () => {
    setup(
      detail({
        status: "failed",
        error: {
          code: "managed_credits_short",
          message: "x",
          retryable: false,
        },
      }),
    );
    await waitFor(() =>
      expect(
        screen.getByText(/관리형 경로를 사용하려면 크레딧 충전이 필요합니다/),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("link", { name: /결제로 이동/ }),
    ).toHaveAttribute("href", "/ko/app/settings/billing");
  });

  it("renders managed_disabled copy", async () => {
    setup(
      detail({
        status: "failed",
        error: {
          code: "managed_disabled",
          message: "x",
          retryable: false,
        },
      }),
    );
    await waitFor(() =>
      expect(
        screen.getByText(/관리형 경로는 아직 준비 중입니다/),
      ).toBeInTheDocument(),
    );
  });
});
