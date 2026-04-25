import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { ResearchHub } from "./ResearchHub";
import koMessages from "../../../messages/ko/research.json";
import { researchApi } from "@/lib/api-client-research";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/lib/api-client-research", () => ({
  researchApi: {
    listRuns: vi.fn(),
    createRun: vi.fn(),
  },
  researchKeys: {
    all: ["research"],
    list: (w: string) => ["research", "list", w],
    detail: (r: string) => ["research", "detail", r],
  },
}));

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="ko" messages={{ research: koMessages }}>
        <ResearchHub
          wsSlug="acme"
          workspaceId="w1"
          projects={[{ id: "p1", name: "P1" }]}
          managedEnabled={false}
        />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("ResearchHub", () => {
  it("renders the title and CTA", async () => {
    vi.mocked(researchApi.listRuns).mockResolvedValueOnce({ runs: [] });
    setup();
    expect(screen.getByText("Deep Research")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText(/아직 시작한 리서치가 없습니다/)).toBeInTheDocument(),
    );
  });

  it("renders the run list", async () => {
    vi.mocked(researchApi.listRuns).mockResolvedValueOnce({
      runs: [
        {
          id: "r1",
          topic: "Topic A",
          model: "deep-research-preview-04-2026",
          status: "completed",
          billingPath: "byok",
          createdAt: "2026-04-25T00:00:00Z",
          updatedAt: "2026-04-25T00:00:00Z",
          completedAt: "2026-04-25T00:30:00Z",
          totalCostUsdCents: 200,
          noteId: "n1",
        },
      ],
    });
    setup();
    await waitFor(() =>
      expect(screen.getByText("Topic A")).toBeInTheDocument(),
    );
  });

  it("opens the dialog when clicking the new button", async () => {
    vi.mocked(researchApi.listRuns).mockResolvedValueOnce({ runs: [] });
    setup();
    fireEvent.click(screen.getByRole("button", { name: /새 리서치 시작/ }));
    expect(
      screen.getByRole("dialog", { name: /새 리서치 시작/ }),
    ).toBeInTheDocument();
  });
});
