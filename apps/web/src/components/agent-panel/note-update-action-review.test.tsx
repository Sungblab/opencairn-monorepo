import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, agentActionsApi } from "@/lib/api-client";
import type { AgentAction } from "@/lib/api-client";

import { NoteUpdateActionReviewList } from "./note-update-action-review";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => {
    if (!values) return key;
    return `${key}:${JSON.stringify(values)}`;
  },
}));

vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api-client")>(
    "@/lib/api-client",
  );
  return {
    ...actual,
    agentActionsApi: {
      list: vi.fn(),
      applyNoteUpdate: vi.fn(),
      transitionStatus: vi.fn(),
    },
  };
});

const projectId = "00000000-0000-4000-8000-000000000001";
const actionId = "00000000-0000-4000-8000-000000000010";
const noteId = "00000000-0000-4000-8000-000000000020";

function renderWithClient() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <NoteUpdateActionReviewList projectId={projectId} />
    </QueryClientProvider>,
  );
}

function draftAction(): AgentAction {
  return {
    id: actionId,
    requestId: "00000000-0000-4000-8000-000000000011",
    workspaceId: "00000000-0000-4000-8000-000000000012",
    projectId,
    actorUserId: "user-1",
    sourceRunId: null,
    kind: "note.update",
    status: "draft",
    risk: "write",
    input: {
      noteId,
      draft: {
        format: "plate_value_v1",
        content: [{ type: "p", children: [{ text: "draft text" }] }],
      },
    },
    preview: {
      noteId,
      source: "yjs",
      current: {
        contentText: "current text",
        yjsStateVectorBase64: "AQID",
      },
      draft: {
        contentText: "draft text with more detail",
      },
      diff: {
        fromVersion: "current",
        toVersion: "current",
        summary: {
          addedBlocks: 0,
          removedBlocks: 0,
          changedBlocks: 1,
          addedWords: 3,
          removedWords: 1,
        },
        blocks: [
          {
            key: "0",
            status: "changed",
            textDiff: [
              { kind: "delete", text: "current" },
              { kind: "insert", text: "draft" },
              { kind: "equal", text: " text" },
            ],
          },
        ],
      },
      applyConstraints: [
        "apply_must_transform_yjs_document",
        "capture_version_before_apply",
        "capture_version_after_apply",
        "reject_if_yjs_state_vector_changed",
      ],
    },
    result: null,
    errorCode: null,
    createdAt: "2026-05-05T00:00:00.000Z",
    updatedAt: "2026-05-05T00:00:00.000Z",
  };
}

describe("NoteUpdateActionReviewList", () => {
  beforeEach(() => {
    vi.mocked(agentActionsApi.list).mockResolvedValue({ actions: [draftAction()] });
    vi.mocked(agentActionsApi.applyNoteUpdate).mockResolvedValue({
      action: { ...draftAction(), status: "completed" },
    });
    vi.mocked(agentActionsApi.transitionStatus).mockResolvedValue({
      action: { ...draftAction(), status: "cancelled" },
    });
  });

  it("renders a note.update draft preview with summaries and stale guidance", async () => {
    renderWithClient();

    expect(await screen.findByText("title")).toBeTruthy();
    expect(screen.getByText("currentLabel")).toBeTruthy();
    expect(screen.getByText("current text")).toBeTruthy();
    expect(screen.getByText("draftLabel")).toBeTruthy();
    expect(screen.getByText("draft text with more detail")).toBeTruthy();
    expect(screen.getByText("diffSummary:{\"changedBlocks\":1,\"addedWords\":3,\"removedWords\":1}")).toBeTruthy();
    expect(screen.getByText("staleWarning")).toBeTruthy();
  });

  it("applies a draft through the agent action API", async () => {
    const user = userEvent.setup();
    renderWithClient();

    await user.click(await screen.findByRole("button", { name: "apply" }));

    expect(agentActionsApi.applyNoteUpdate).toHaveBeenCalledWith(actionId, {
      yjsStateVectorBase64: "AQID",
    });
    await waitFor(() => expect(screen.getByText("applied")).toBeTruthy());
  });

  it("shows an understandable stale-preview error", async () => {
    vi.mocked(agentActionsApi.applyNoteUpdate).mockRejectedValue(
      new ApiError(409, "note_update_stale_preview"),
    );
    const user = userEvent.setup();
    renderWithClient();

    await user.click(await screen.findByRole("button", { name: "apply" }));

    await waitFor(() => expect(screen.getByText("staleError")).toBeTruthy());
  });

  it("cancels a draft action through the status transition API", async () => {
    const user = userEvent.setup();
    renderWithClient();

    await user.click(await screen.findByRole("button", { name: "reject" }));

    expect(agentActionsApi.transitionStatus).toHaveBeenCalledWith(actionId, {
      status: "cancelled",
    });
    await waitFor(() => expect(screen.getByText("cancelled")).toBeTruthy());
  });
});
