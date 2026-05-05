import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { agentActionsApi } from "@/lib/api-client";
import type { AgentAction } from "@/lib/api-client";

import { CodeProjectActionReviewList } from "./code-project-action-review";

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
      applyCodeProjectPatch: vi.fn(),
      transitionStatus: vi.fn(),
    },
  };
});

const projectId = "00000000-0000-4000-8000-000000000001";
const actionId = "00000000-0000-4000-8000-000000000010";

function renderWithClient() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <CodeProjectActionReviewList projectId={projectId} />
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
    kind: "code_project.patch",
    status: "draft",
    risk: "write",
    input: {
      codeWorkspaceId: "00000000-0000-4000-8000-000000000020",
      baseSnapshotId: "00000000-0000-4000-8000-000000000021",
      operations: [
        {
          op: "update",
          path: "src/App.tsx",
          beforeHash: "sha256:old",
          afterHash: "sha256:new",
          inlineContent: "new",
        },
      ],
      preview: { filesChanged: 1, additions: 3, deletions: 1, summary: "Update app" },
    },
    preview: { filesChanged: 1, additions: 3, deletions: 1, summary: "Update app" },
    result: null,
    errorCode: null,
    createdAt: "2026-05-05T00:00:00.000Z",
    updatedAt: "2026-05-05T00:00:00.000Z",
  };
}

describe("CodeProjectActionReviewList", () => {
  beforeEach(() => {
    vi.mocked(agentActionsApi.list).mockResolvedValue({ actions: [draftAction()] });
    vi.mocked(agentActionsApi.applyCodeProjectPatch).mockResolvedValue({
      action: { ...draftAction(), status: "completed" },
    });
    vi.mocked(agentActionsApi.transitionStatus).mockResolvedValue({
      action: { ...draftAction(), status: "cancelled" },
    });
  });

  it("renders a code_project.patch draft preview", async () => {
    renderWithClient();

    expect(await screen.findByText("title")).toBeTruthy();
    expect(screen.getByText("Update app")).toBeTruthy();
    expect(screen.getByText("diffSummary:{\"filesChanged\":1,\"additions\":3,\"deletions\":1}")).toBeTruthy();
    expect(screen.getByText("operationLabel")).toBeTruthy();
    expect(screen.getByText("src/App.tsx")).toBeTruthy();
  });

  it("applies a draft patch through the agent action API", async () => {
    const user = userEvent.setup();
    renderWithClient();

    await user.click(await screen.findByRole("button", { name: "apply" }));

    expect(agentActionsApi.applyCodeProjectPatch).toHaveBeenCalledWith(actionId);
    await waitFor(() => expect(screen.getByText("applied")).toBeTruthy());
  });

  it("cancels a draft patch through the status transition API", async () => {
    const user = userEvent.setup();
    renderWithClient();

    await user.click(await screen.findByRole("button", { name: "reject" }));

    expect(agentActionsApi.transitionStatus).toHaveBeenCalledWith(actionId, {
      status: "cancelled",
    });
    await waitFor(() => expect(screen.getByText("cancelled")).toBeTruthy());
  });
});
