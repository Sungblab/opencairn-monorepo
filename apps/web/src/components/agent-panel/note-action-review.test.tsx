import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type React from "react";
import { describe, expect, it, vi } from "vitest";

import { agentActionsApi } from "@/lib/api-client";
import { NoteActionReviewList } from "./note-action-review";

vi.mock("@/lib/api-client", () => ({
  agentActionsApi: {
    list: vi.fn(),
    apply: vi.fn(),
    transitionStatus: vi.fn(),
  },
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const projectId = "00000000-0000-4000-8000-000000000002";
const actionId = "00000000-0000-4000-8000-000000000010";

describe("NoteActionReviewList", () => {
  it("renders approval-required note actions and applies them", async () => {
    vi.mocked(agentActionsApi.list).mockResolvedValue({
      actions: [
        {
          id: actionId,
          requestId: "00000000-0000-4000-8000-000000000011",
          workspaceId: "00000000-0000-4000-8000-000000000001",
          projectId,
          actorUserId: "user-1",
          sourceRunId: "run-1",
          kind: "note.create",
          status: "approval_required",
          risk: "write",
          input: { title: "Project brief", folderId: null },
          preview: null,
          result: null,
          errorCode: null,
          createdAt: "2026-05-12T00:00:00.000Z",
          updatedAt: "2026-05-12T00:00:00.000Z",
        },
        {
          id: "00000000-0000-4000-8000-000000000012",
          requestId: "00000000-0000-4000-8000-000000000013",
          workspaceId: "00000000-0000-4000-8000-000000000001",
          projectId,
          actorUserId: "user-1",
          sourceRunId: "run-1",
          kind: "note.create_from_markdown",
          status: "approval_required",
          risk: "write",
          input: {
            title: "PDF 요약 노트",
            folderId: null,
            bodyMarkdown: "# PDF 요약",
          },
          preview: null,
          result: null,
          errorCode: null,
          createdAt: "2026-05-12T00:00:00.000Z",
          updatedAt: "2026-05-12T00:00:00.000Z",
        },
      ],
    });
    vi.mocked(agentActionsApi.apply).mockResolvedValue({
      action: {} as never,
    });

    renderWithQuery(<NoteActionReviewList projectId={projectId} />);

    expect(await screen.findByText("note.create")).toBeInTheDocument();
    expect(screen.getByText("Project brief")).toBeInTheDocument();
    expect(screen.getByText("note.create_from_markdown")).toBeInTheDocument();
    expect(screen.getByText("PDF 요약 노트")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "apply" })[0]);

    await waitFor(() => expect(agentActionsApi.apply).toHaveBeenCalledWith(actionId));
  });
});

function renderWithQuery(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}
