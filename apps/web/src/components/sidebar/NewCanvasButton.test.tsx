import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import koCanvasMessages from "../../../messages/ko/canvas.json";
import koSidebarMessages from "../../../messages/ko/sidebar.json";
import { NewCanvasButton } from "./NewCanvasButton";
import { api, type NoteRow } from "@/lib/api-client";

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
  vi.mocked(api.createNote).mockResolvedValue({
    id: "new-canvas-id",
    projectId: "p1",
    workspaceId: "ws-1",
    folderId: null,
    inheritParent: true,
    sourceType: "canvas",
    sourceFileKey: null,
    sourceUrl: null,
    mimeType: null,
    canvasLanguage: "python",
    title: "이름 없는 캔버스",
    content: null,
    contentText: "",
    type: "source",
    isAuto: false,
    createdAt: "2026-05-12T00:00:00.000Z",
    updatedAt: "2026-05-12T00:00:00.000Z",
    deletedAt: null,
  } satisfies NoteRow);
});

describe("NewCanvasButton", () => {
  it("renders the button with i18n label", () => {
    render(wrap(<NewCanvasButton workspaceSlug="acme" projectId="p1" />));
    expect(
      screen.getByRole("button", { name: /새 캔버스/ }),
    ).toBeInTheDocument();
  });

  it("on click: POSTs canvas note + navigates to /workspace/<slug>/note/<id>", async () => {
    render(wrap(<NewCanvasButton workspaceSlug="acme" projectId="p1" />));

    fireEvent.click(screen.getByRole("button", { name: /새 캔버스/ }));

    await waitFor(() => {
      expect(api.createNote).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: "p1",
          title: "",
          sourceType: "canvas",
          canvasLanguage: "python",
          contentText: "",
        }),
      );
    });
    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith(
        "/ko/workspace/acme/note/new-canvas-id",
      );
    });
  });

  it("shows immediate pending feedback while canvas creation is in flight", async () => {
    vi.mocked(api.createNote).mockImplementation(
      () => new Promise(() => undefined),
    );
    render(wrap(<NewCanvasButton workspaceSlug="acme" projectId="p1" />));

    fireEvent.click(screen.getByRole("button", { name: /새 캔버스/ }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /캔버스 생성 중/ }),
      ).toBeDisabled();
    });
  });
});
