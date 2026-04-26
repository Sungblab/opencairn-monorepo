// Plan 2C Task 9 — ShareDialog smoke tests.
//
// We mock @/lib/api-client wholesale because the dialog is a thin wrapper
// over TanStack Query around those five surfaces (shareApi.{list,create,
// revoke}, notePermissionsApi.{list,grant,update,revoke},
// workspaceMembersApi.search). The behaviour we want to lock in here is:
//
//   1. Both sections render when `open=true` (no false-conditional gating).
//   2. The "Share to web" toggle calls shareApi.create("viewer") on first
//      activation — the role default matters because the public viewer in
//      Task 8 only handles read-only state today.
//
// Member search and per-permission rows are exercised separately by manual
// smoke + the post-feature E2E (deferred). Keeping this suite to two tests
// keeps the unit cost low while still failing loudly on i18n key drift or a
// regression in the toggle wiring.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";

import { ShareDialog } from "./share-dialog";

vi.mock("@/lib/api-client", () => ({
  shareApi: {
    list: vi.fn(async () => ({ links: [] })),
    create: vi.fn(async (_noteId: string, role: string) => ({
      id: "link-1",
      token: "T".repeat(43),
      role,
      createdAt: "2026-04-26T00:00:00Z",
      createdBy: { id: "u1", name: "Owner" },
    })),
    revoke: vi.fn(async () => undefined),
  },
  notePermissionsApi: {
    list: vi.fn(async () => ({ permissions: [] })),
    grant: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    revoke: vi.fn(async () => undefined),
  },
  workspaceMembersApi: {
    search: vi.fn(async () => ({ members: [] })),
  },
}));

const messages = {
  shareDialog: {
    title: "공유",
    invitePeople: "사용자 초대",
    inviteSearchPlaceholder: "워크스페이스 멤버 검색",
    addButton: "부여",
    role: { viewer: "보기", commenter: "댓글", editor: "편집" },
    removeMember: "권한 회수",
    webShareToggle: "웹에서 공유",
    webShareCopy: "복사",
    webShareCopied: "복사됨",
    webShareRevoke: "링크 폐기",
    webShareCreatedBy: "생성: {name} · {date}",
    viewOnlyBanner: "보기 전용으로 공유됨",
    notWorkspaceMember: "워크스페이스 멤버만 부여할 수 있습니다",
  },
};

function renderDialog() {
  // retry:false keeps test failures actionable — we want a single rejection
  // to surface immediately rather than after three quiet retries.
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="ko" messages={messages}>
        <ShareDialog
          noteId="n1"
          workspaceId="w1"
          open={true}
          onOpenChange={() => undefined}
        />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("ShareDialog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders both sections (Invite + Web)", async () => {
    renderDialog();
    expect(await screen.findByText("사용자 초대")).toBeInTheDocument();
    expect(screen.getByText("웹에서 공유")).toBeInTheDocument();
  });

  it("creates a public share link when toggled on", async () => {
    const { shareApi } = await import("@/lib/api-client");
    renderDialog();
    const toggle = await screen.findByRole("switch", { name: /웹에서 공유/ });
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(shareApi.create).toHaveBeenCalledWith("n1", "viewer"),
    );
  });
});
