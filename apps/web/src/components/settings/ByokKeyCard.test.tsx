import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import settingsKo from "../../../messages/ko/settings.json";
import { ByokKeyCard } from "./ByokKeyCard";

const { toastSuccessMock, toastErrorMock } = vi.hoisted(() => ({
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: { success: toastSuccessMock, error: toastErrorMock },
}));

vi.mock("@/lib/api-client-byok-key", () => ({
  byokKeyQueryKey: () => ["byok-key"] as const,
  getByokKey: vi.fn(),
  setByokKey: vi.fn(),
  deleteByokKey: vi.fn(),
  ByokKeyApiError: class ByokKeyApiError extends Error {
    constructor(public readonly code: string, message: string) {
      super(message);
    }
  },
}));

import {
  getByokKey,
  setByokKey,
  deleteByokKey,
  ByokKeyApiError,
} from "@/lib/api-client-byok-key";

function renderCard() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="ko" messages={{ settings: settingsKo }}>
        <ByokKeyCard />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("ByokKeyCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the empty state with a key input + save button", async () => {
    vi.mocked(getByokKey).mockResolvedValue({ registered: false });
    renderCard();
    await screen.findByPlaceholderText("AIza…");
    expect(screen.getByRole("button", { name: "저장" })).toBeInTheDocument();
  });

  it("renders the registered state with masked last4 + replace + delete", async () => {
    vi.mocked(getByokKey).mockResolvedValue({
      registered: true,
      lastFour: "abcd",
      updatedAt: "2026-04-26T10:00:00.000Z",
    });
    renderCard();
    expect(await screen.findByText(/abcd/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "교체" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "삭제" })).toBeInTheDocument();
  });

  it("calls setByokKey on save and shows success toast", async () => {
    vi.mocked(getByokKey).mockResolvedValue({ registered: false });
    vi.mocked(setByokKey).mockResolvedValue({
      registered: true,
      lastFour: "wxyz",
      updatedAt: "2026-04-26T10:00:00.000Z",
    });
    renderCard();
    const input = await screen.findByPlaceholderText("AIza…");
    fireEvent.change(input, {
      target: { value: "AI" + "zaSyTestPhaseEUiSaveCase1234wxyz" },
    });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() =>
      expect(setByokKey).toHaveBeenCalledWith(
        "AI" + "zaSyTestPhaseEUiSaveCase1234wxyz",
      ),
    );
    await waitFor(() => expect(toastSuccessMock).toHaveBeenCalled());
  });

  it("displays the i18n error message when save fails with wrong_prefix", async () => {
    vi.mocked(getByokKey).mockResolvedValue({ registered: false });
    vi.mocked(setByokKey).mockRejectedValue(
      new ByokKeyApiError("wrong_prefix", "boom"),
    );
    renderCard();
    const input = await screen.findByPlaceholderText("AIza…");
    fireEvent.change(input, {
      target: { value: "WRONG_PREFIX_TestKeyForUiTesting" },
    });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await screen.findByText(/올바른 Gemini API 키 형식이 아닙니다/);
  });

  it("opens delete confirmation and calls deleteByokKey on confirm", async () => {
    vi.mocked(getByokKey).mockResolvedValue({
      registered: true,
      lastFour: "abcd",
      updatedAt: "2026-04-26T10:00:00.000Z",
    });
    vi.mocked(deleteByokKey).mockResolvedValue({ registered: false });
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "삭제" }));
    expect(
      await screen.findByText("API 키를 삭제할까요?"),
    ).toBeInTheDocument();
    // The dialog has its own "삭제" button — pick the last "삭제" in the DOM.
    const allDelete = screen.getAllByRole("button", { name: "삭제" });
    fireEvent.click(allDelete[allDelete.length - 1]!);
    await waitFor(() => expect(deleteByokKey).toHaveBeenCalledTimes(1));
  });
});
