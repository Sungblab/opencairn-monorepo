import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import koCanvasMessages from "../../../messages/ko/canvas.json";
import koSidebarMessages from "../../../messages/ko/sidebar.json";
import { NewCanvasButton } from "./NewCanvasButton";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/lib/api-client", () => ({
  api: {
    createNote: vi.fn().mockResolvedValue({
      id: "new-canvas-id",
      sourceType: "canvas",
      canvasLanguage: "python",
      title: "이름 없는 캔버스",
    }),
  },
}));

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <NextIntlClientProvider
      locale="ko"
      messages={{ canvas: koCanvasMessages, sidebar: koSidebarMessages }}
    >
      <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
    </NextIntlClientProvider>
  );
}

beforeEach(() => {
  pushMock.mockClear();
});

describe("NewCanvasButton", () => {
  it("renders the button with i18n label", () => {
    render(wrap(<NewCanvasButton workspaceSlug="acme" projectId="p1" />));
    expect(
      screen.getByRole("button", { name: /새 캔버스/ }),
    ).toBeInTheDocument();
  });

  it("on click: POSTs canvas note + navigates to the workspace note route", async () => {
    const { api } = await import("@/lib/api-client");
    render(wrap(<NewCanvasButton workspaceSlug="acme" projectId="p1" />));

    fireEvent.click(screen.getByRole("button", { name: /새 캔버스/ }));

    await waitFor(() => {
      expect(api.createNote).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: "p1",
          sourceType: "canvas",
          canvasLanguage: "python",
          contentText: "",
        }),
      );
    });
    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith(
        "/ko/app/w/acme/n/new-canvas-id",
      );
    });
  });
});
