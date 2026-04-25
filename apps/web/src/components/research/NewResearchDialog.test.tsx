import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { NewResearchDialog } from "./NewResearchDialog";
import koMessages from "../../../messages/ko/research.json";
import { researchApi } from "@/lib/api-client-research";

vi.mock("@/lib/api-client-research", () => ({
  researchApi: { createRun: vi.fn() },
  researchKeys: {
    all: ["research"],
    list: (w: string) => ["research", "list", w],
    detail: (r: string) => ["research", "detail", r],
  },
}));

function setup({ managedEnabled = false }: { managedEnabled?: boolean } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onCreated = vi.fn();
  const onClose = vi.fn();
  return {
    onCreated,
    onClose,
    ...render(
      <QueryClientProvider client={qc}>
        <NextIntlClientProvider locale="ko" messages={{ research: koMessages }}>
          <NewResearchDialog
            open
            onClose={onClose}
            onCreated={onCreated}
            workspaceId="w1"
            projects={[
              { id: "p1", name: "Project One" },
              { id: "p2", name: "Project Two" },
            ]}
            managedEnabled={managedEnabled}
          />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    ),
  };
}

describe("NewResearchDialog", () => {
  it("disables submit until topic + project are filled", () => {
    setup();
    const submit = screen.getByRole("button", { name: /시작하기/ });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/주제/), {
      target: { value: "trends" },
    });
    fireEvent.change(screen.getByLabelText(/프로젝트/), {
      target: { value: "p1" },
    });
    expect(submit).toBeEnabled();
  });

  it("hides Managed billing path when managedEnabled is false", () => {
    setup({ managedEnabled: false });
    expect(screen.queryByLabelText(/관리형 크레딧/)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/내 키 \(BYOK\)/)).toBeInTheDocument();
  });

  it("shows Managed when flag is on", () => {
    setup({ managedEnabled: true });
    expect(screen.getByLabelText(/관리형 크레딧/)).toBeInTheDocument();
  });

  it("submits and calls onCreated with the runId", async () => {
    vi.mocked(researchApi.createRun).mockResolvedValueOnce({ runId: "r-new" });
    const { onCreated } = setup();
    fireEvent.change(screen.getByLabelText(/주제/), {
      target: { value: "topic" },
    });
    fireEvent.change(screen.getByLabelText(/프로젝트/), {
      target: { value: "p1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /시작하기/ }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("r-new"));
    expect(researchApi.createRun).toHaveBeenCalledWith({
      workspaceId: "w1",
      projectId: "p1",
      topic: "topic",
      model: "deep-research-preview-04-2026",
      billingPath: "byok",
    });
  });
});
