import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgenticPlan } from "@opencairn/shared";

import { agenticPlansApi } from "@/lib/api-client";
import { AgenticPlanCard } from "./agentic-plan-card";

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
    agenticPlansApi: {
      list: vi.fn(),
      create: vi.fn(),
      get: vi.fn(),
      start: vi.fn(),
      recover: vi.fn(),
    },
  };
});

const projectId = "00000000-0000-4000-8000-000000000001";

function renderWithClient(plans: AgenticPlan[] = []) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
  vi.mocked(agenticPlansApi.list).mockResolvedValue({ plans });
  const view = render(
    <QueryClientProvider client={qc}>
      <AgenticPlanCard projectId={projectId} />
    </QueryClientProvider>,
  );
  return { ...view, invalidateSpy };
}

describe("AgenticPlanCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(agenticPlansApi.create).mockResolvedValue({ plan: planFixture() });
    vi.mocked(agenticPlansApi.start).mockResolvedValue({ plan: planFixture() });
    vi.mocked(agenticPlansApi.recover).mockResolvedValue({ plan: planFixture() });
  });

  it("renders the empty state when there are no plans", async () => {
    renderWithClient([]);

    expect(await screen.findByText("empty")).toBeTruthy();
  });

  it("creates a plan, clears the goal field, and invalidates plan/run queries", async () => {
    const user = userEvent.setup();
    const { invalidateSpy } = renderWithClient([]);

    const textarea = await screen.findByLabelText("goalLabel");
    await user.type(textarea, "Coordinate launch notes");
    await user.click(screen.getByRole("button", { name: /create/ }));

    await waitFor(() => {
      expect(agenticPlansApi.create).toHaveBeenCalledWith(projectId, {
        goal: "Coordinate launch notes",
      });
    });
    expect((textarea as HTMLTextAreaElement).value).toBe("");
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["agentic-plans", projectId],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["workflow-console-runs", projectId],
    });
  });

  it("renders plan progress and step count", async () => {
    renderWithClient([planFixture()]);

    expect(await screen.findByText("Prepare launch plan")).toBeTruthy();
    expect(screen.getByText("status.approval_required · progress:{\"completed\":1,\"total\":2}")).toBeTruthy();
    expect(screen.getByText("Review note update")).toBeTruthy();
  });

  it("renders a stable reason for blocked steps", async () => {
    renderWithClient([
      planFixture({
        status: "blocked",
        stepStatus: "blocked",
        errorCode: "agentic_plan_step_missing_input",
      }),
    ]);

    expect(await screen.findByText(
      "stepIssue:{\"reason\":\"agentic_plan_step_missing_input\"}",
    )).toBeTruthy();
  });

  it("starts a plan through the API", async () => {
    const user = userEvent.setup();
    renderWithClient([planFixture()]);

    await user.click(await screen.findByRole("button", { name: /start/ }));

    await waitFor(() => {
      expect(agenticPlansApi.start).toHaveBeenCalledWith(
        projectId,
        "00000000-0000-4000-8000-000000000010",
        {},
      );
    });
  });

  it("adds a manual recovery review for blocked steps", async () => {
    const user = userEvent.setup();
    renderWithClient([
      planFixture({
        status: "blocked",
        stepStatus: "blocked",
      }),
    ]);

    await user.click(await screen.findByRole("button", { name: /recover/ }));

    await waitFor(() => {
      expect(agenticPlansApi.recover).toHaveBeenCalledWith(
        projectId,
        "00000000-0000-4000-8000-000000000010",
        {
          stepId: "00000000-0000-4000-8000-000000000011",
          strategy: "manual_review",
        },
      );
    });
  });

  it("offers retry and manual review recovery for stale evidence blockers", async () => {
    const user = userEvent.setup();
    renderWithClient([
      planFixture({
        status: "blocked",
        stepStatus: "blocked",
        errorCode: "stale_context",
        recoveryCode: "stale_context",
      }),
    ]);

    await user.click(await screen.findByRole("button", { name: /retry/ }));

    await waitFor(() => {
      expect(agenticPlansApi.recover).toHaveBeenCalledWith(
        projectId,
        "00000000-0000-4000-8000-000000000010",
        {
          stepId: "00000000-0000-4000-8000-000000000011",
          strategy: "retry",
        },
      );
    });

    await user.click(screen.getByRole("button", { name: /recover/ }));

    await waitFor(() => {
      expect(agenticPlansApi.recover).toHaveBeenLastCalledWith(
        projectId,
        "00000000-0000-4000-8000-000000000010",
        {
          stepId: "00000000-0000-4000-8000-000000000011",
          strategy: "manual_review",
        },
      );
    });
  });

  it("requires confirmation before cancelling a blocked recovery step", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderWithClient([
      planFixture({
        status: "blocked",
        stepStatus: "blocked",
        errorCode: "missing_source",
        recoveryCode: "missing_source",
      }),
    ]);

    await user.click(await screen.findByRole("button", { name: /cancel/ }));

    await waitFor(() => {
      expect(confirmSpy).toHaveBeenCalledWith("cancelConfirm");
      expect(agenticPlansApi.recover).toHaveBeenCalledWith(
        projectId,
        "00000000-0000-4000-8000-000000000010",
        {
          stepId: "00000000-0000-4000-8000-000000000011",
          strategy: "cancel",
        },
      );
    });
  });

  it("does not cancel a recovery step when confirmation is declined", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderWithClient([
      planFixture({
        status: "blocked",
        stepStatus: "blocked",
        errorCode: "missing_source",
        recoveryCode: "missing_source",
      }),
    ]);

    await user.click(await screen.findByRole("button", { name: /cancel/ }));

    expect(agenticPlansApi.recover).not.toHaveBeenCalled();
  });
});

function planFixture(options: {
  status?: AgenticPlan["status"];
  stepStatus?: AgenticPlan["steps"][number]["status"];
  errorCode?: string | null;
  recoveryCode?: AgenticPlan["steps"][number]["recoveryCode"];
} = {}): AgenticPlan {
  const now = "2026-05-06T00:00:00.000Z";
  return {
    id: "00000000-0000-4000-8000-000000000010",
    workspaceId: "00000000-0000-4000-8000-000000000002",
    projectId,
    actorUserId: "user-1",
    title: "Prepare launch plan",
    goal: "Coordinate launch notes",
    status: options.status ?? "approval_required",
    target: {
      workspaceId: "00000000-0000-4000-8000-000000000002",
      projectId,
    },
    plannerKind: "deterministic",
    summary: "2-step deterministic plan",
    currentStepOrdinal: 1,
    steps: [
      {
        id: "00000000-0000-4000-8000-000000000011",
        planId: "00000000-0000-4000-8000-000000000010",
        ordinal: 1,
        kind: "note.review_update",
        title: "Review note update",
        rationale: "The goal references note content.",
        status: options.stepStatus ?? "completed",
        risk: "write",
        input: {},
        linkedRunType: null,
        linkedRunId: null,
        errorCode: options.errorCode ?? null,
        recoveryCode: options.recoveryCode ?? null,
        errorMessage: null,
        createdAt: now,
        updatedAt: now,
        completedAt: now,
      },
      {
        id: "00000000-0000-4000-8000-000000000012",
        planId: "00000000-0000-4000-8000-000000000010",
        ordinal: 2,
        kind: "file.export",
        title: "Prepare export",
        rationale: "The goal asks for an export.",
        status: "approval_required",
        risk: "external",
        input: {},
        linkedRunType: null,
        linkedRunId: null,
        errorCode: null,
        errorMessage: null,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
      },
    ],
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  };
}
