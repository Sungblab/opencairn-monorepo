import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { SharedLinksTab } from "./shared-links-tab";

vi.mock("@/lib/api-client", () => ({
  wsSettingsApi: {
    sharedLinks: vi.fn(async () => ({
      links: [
        {
          id: "l1",
          token: "T".repeat(43),
          role: "viewer",
          noteId: "n1",
          noteTitle: "Note 1",
          createdAt: "2026-04-26T00:00:00Z",
          createdBy: { id: "u1", name: "Alice" },
        },
      ],
    })),
  },
  shareApi: {
    revoke: vi.fn(async () => undefined),
  },
}));

const messages = {
  workspaceSettings: {
    sharedLinks: {
      heading: "공유 링크",
      empty: "활성 공유 링크가 없습니다",
      headerNote: "노트",
      headerRole: "권한",
      headerCreatedBy: "생성자",
      headerCreatedAt: "생성일",
      revoke: "폐기",
    },
  },
  shareDialog: { role: { viewer: "보기", commenter: "댓글", editor: "편집" } },
};

function renderTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="ko" messages={messages}>
        <SharedLinksTab wsId="w1" />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("SharedLinksTab", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists active links with note title and creator", async () => {
    renderTab();
    expect(await screen.findByText("Note 1")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  it("revokes a link when the revoke button is clicked", async () => {
    const { shareApi } = await import("@/lib/api-client");
    renderTab();
    await screen.findByText("Note 1");
    fireEvent.click(screen.getByText("폐기"));
    await waitFor(() => expect(shareApi.revoke).toHaveBeenCalledWith("l1"));
  });
});
