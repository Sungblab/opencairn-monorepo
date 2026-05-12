import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AgentAction } from "@opencairn/shared";

import { agentActionsApi } from "@/lib/api-client";
import { InteractionActionCard } from "./interaction-action-card";

vi.mock("@/lib/api-client", () => ({
  agentActionsApi: {
    respondToInteractionChoice: vi.fn(),
  },
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const action: AgentAction = {
  id: "00000000-0000-4000-8000-000000000010",
  requestId: "00000000-0000-4000-8000-000000000011",
  workspaceId: "00000000-0000-4000-8000-000000000001",
  projectId: "00000000-0000-4000-8000-000000000002",
  actorUserId: "user-1",
  sourceRunId: null,
  kind: "interaction.choice",
  status: "draft",
  risk: "low",
  input: {
    cardId: "format",
    prompt: "어떤 형태로 만들까요?",
    options: [
      {
        id: "summary",
        label: "요약 노트",
        value: "요약 노트로 만들어줘",
      },
    ],
    allowCustom: true,
    source: {},
  },
  preview: null,
  result: null,
  errorCode: null,
  createdAt: "2026-05-12T00:00:00.000Z",
  updatedAt: "2026-05-12T00:00:00.000Z",
};

describe("InteractionActionCard", () => {
  it("responds to a pending ledger-backed choice card once", async () => {
    const onAnswered = vi.fn();
    vi.mocked(agentActionsApi.respondToInteractionChoice).mockResolvedValue({
      action: { ...action, status: "completed" },
    });

    render(<InteractionActionCard action={action} onAnswered={onAnswered} />);

    fireEvent.click(screen.getByRole("button", { name: "요약 노트" }));
    fireEvent.click(screen.getByRole("button", { name: "요약 노트" }));

    await waitFor(() =>
      expect(agentActionsApi.respondToInteractionChoice).toHaveBeenCalledTimes(1),
    );
    expect(agentActionsApi.respondToInteractionChoice).toHaveBeenCalledWith(
      action.id,
      {
        optionId: "summary",
        value: "요약 노트로 만들어줘",
        label: "요약 노트",
      },
    );
    expect(onAnswered).toHaveBeenCalledWith(
      expect.objectContaining({
        action: expect.objectContaining({ id: action.id }),
        optionId: "summary",
        value: "요약 노트로 만들어줘",
        label: "요약 노트",
      }),
    );
  });
});
