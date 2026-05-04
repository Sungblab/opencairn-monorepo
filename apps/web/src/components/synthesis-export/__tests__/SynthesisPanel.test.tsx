import type React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SynthesisPanel } from "../SynthesisPanel";
import messages from "../../../../messages/ko/synthesis-export.json";

// Mock useSynthesisStream so EventSource is not needed in jsdom
vi.mock("../../../hooks/use-synthesis-stream", () => ({
  useSynthesisStream: () => ({
    status: "queued",
    sourceCount: 0,
    tokensUsed: 0,
    docUrl: null,
    format: null,
    errorCode: null,
  }),
}));

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider
        locale="ko"
        messages={{ synthesisExport: messages }}
      >
        <SynthesisPanel workspaceId="ws-1" projectId={null} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("SynthesisPanel", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        runId: "11111111-1111-1111-1111-111111111111",
      }),
    });
  });

  it("renders the title, textarea, and submit button", () => {
    setup();
    expect(screen.getByText("종합 내보내기")).toBeDefined();
    expect(
      screen.getByPlaceholderText(/어떤 문서/),
    ).toBeDefined();
    expect(screen.getByText("합성 시작")).toBeDefined();
  });

  it("submit button is disabled when prompt is empty", () => {
    setup();
    const btn = screen.getByText("합성 시작").closest("button")!;
    expect(btn.disabled).toBe(true);
  });

  it("submit button is disabled when prompt has text but no sources and autoSearch is off", () => {
    setup();
    const textarea = screen.getByPlaceholderText(/어떤 문서/);
    fireEvent.change(textarea, { target: { value: "test prompt" } });
    const btn = screen.getByText("합성 시작").closest("button")!;
    expect(btn.disabled).toBe(true);
  });

  it("calls POST /api/synthesis-export/run when submitted with autoSearch enabled", async () => {
    setup();

    // Enable autoSearch so the submit button becomes active
    const checkbox = screen.getByRole("checkbox");
    fireEvent.click(checkbox);

    // Enter a prompt
    const textarea = screen.getByPlaceholderText(/어떤 문서/);
    fireEvent.change(textarea, { target: { value: "IEEE 형식으로 작성해주세요." } });

    // Submit button should now be enabled
    const btn = screen.getByText("합성 시작").closest("button")!;
    expect(btn.disabled).toBe(false);

    fireEvent.click(btn);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/synthesis-export/run",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });
});
