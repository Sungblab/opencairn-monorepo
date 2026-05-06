import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  workflowConsoleApi,
  type WorkflowConsoleRun,
} from "@/lib/api-client";

import { WorkflowConsoleRuns } from "./workflow-console-runs";

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
    workflowConsoleApi: {
      list: vi.fn(),
      get: vi.fn(),
    },
  };
});

const projectId = "00000000-0000-4000-8000-000000000001";

function renderWithClient(projectIdValue: string | null = projectId) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <WorkflowConsoleRuns projectId={projectIdValue} />
    </QueryClientProvider>,
  );
}

function run(overrides: Partial<WorkflowConsoleRun>): WorkflowConsoleRun {
  return {
    runId: "import:00000000-0000-4000-8000-000000000050",
    runType: "import",
    sourceId: "00000000-0000-4000-8000-000000000050",
    sourceStatus: "failed",
    workspaceId: "00000000-0000-4000-8000-000000000002",
    projectId,
    actorUserId: "user-1",
    title: "Import markdown_zip",
    status: "failed",
    risk: "write",
    progress: { current: 8, total: 10, percent: 80 },
    outputs: [
      {
        outputType: "import",
        id: "00000000-0000-4000-8000-000000000050",
        label: "vault.zip",
      },
    ],
    approvals: [],
    error: {
      code: "import_failed",
      message: "Import could not be started. Please try again.",
      retryable: true,
    },
    createdAt: "2026-05-05T00:00:00.000Z",
    updatedAt: "2026-05-05T00:01:00.000Z",
    completedAt: "2026-05-05T00:01:00.000Z",
    ...overrides,
  };
}

describe("WorkflowConsoleRuns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(workflowConsoleApi.list).mockResolvedValue({
      runs: [run({})],
    });
  });

  it("renders latest normalized project runs with progress and outputs", async () => {
    renderWithClient();

    expect(await screen.findByText("Import markdown_zip")).toBeTruthy();
    expect(screen.getByText("type.import · status.failed")).toBeTruthy();
    expect(screen.getByText("progress:{\"percent\":80}")).toBeTruthy();
    expect(screen.getByText("vault.zip")).toBeTruthy();
    expect(
      screen.getByText("Import could not be started. Please try again."),
    ).toBeTruthy();
    expect(workflowConsoleApi.list).toHaveBeenCalledWith(projectId, 5);
  });

  it("renders export outputs as links when the projection provides a URL", async () => {
    vi.mocked(workflowConsoleApi.list).mockResolvedValue({
      runs: [
        run({
          runId: "export:00000000-0000-4000-8000-000000000060",
          runType: "export",
          title: "Export pdf",
          status: "completed",
          progress: null,
          error: null,
          outputs: [
            {
              outputType: "export",
              id: "00000000-0000-4000-8000-000000000061",
              label: "pdf export",
              url: "/api/synthesis-export/runs/00000000-0000-4000-8000-000000000060/document",
            },
          ],
        }),
      ],
    });

    renderWithClient();

    const link = await screen.findByRole("link", { name: /pdf export/ });
    expect(link.getAttribute("href")).toBe(
      "/api/synthesis-export/runs/00000000-0000-4000-8000-000000000060/document",
    );
  });

  it("renders log output metadata for completed code installs", async () => {
    vi.mocked(workflowConsoleApi.list).mockResolvedValue({
      runs: [
        run({
          runId: "agent_action:00000000-0000-4000-8000-000000000070",
          runType: "agent_action",
          title: "code_project.install",
          status: "completed",
          progress: null,
          error: null,
          outputs: [
            {
              outputType: "log",
              id: "00000000-0000-4000-8000-000000000070:install",
              label: "Dependency install",
              metadata: {
                packageManager: "pnpm",
                installed: [
                  { name: "zod", version: "3.25.0", dev: false },
                  { name: "@vitejs/plugin-react", dev: true },
                ],
                exitCode: 0,
              },
            },
          ],
        }),
      ],
    });

    renderWithClient();

    expect(await screen.findByText("Dependency install")).toBeTruthy();
    expect(screen.getByText("logSummary:{\"packageManager\":\"pnpm\",\"packages\":\"zod@3.25.0, @vitejs/plugin-react\",\"exitCode\":0}")).toBeTruthy();
  });

  it("renders agentic plan stale evidence and verifier summaries", async () => {
    vi.mocked(workflowConsoleApi.list).mockResolvedValue({
      runs: [
        run({
          runId: "agentic_plan:00000000-0000-4000-8000-000000000080",
          runType: "agentic_plan",
          title: "Review stale evidence",
          status: "blocked",
          progress: { current: 0, total: 1, percent: 0 },
          error: {
            code: "stale_context",
            message: "Step evidence is stale.",
            retryable: true,
          },
          outputs: [
            {
              outputType: "preview",
              id: "00000000-0000-4000-8000-000000000080",
              label: "1-step deterministic plan",
              metadata: {
                staleEvidenceBlockers: 1,
                verificationStatus: "blocked",
                recoveryCodes: ["stale_context"],
                evidenceFreshness: { stale: 1 },
                staleEvidenceRefs: [
                  {
                    type: "note_analysis_job",
                    noteId: "00000000-0000-4000-8000-000000000091",
                    jobId: "00000000-0000-4000-8000-000000000092",
                  },
                ],
              },
            },
          ],
        }),
      ],
    });

    renderWithClient();

    expect(await screen.findByText("Review stale evidence")).toBeTruthy();
    expect(screen.getByText("evidenceSummary:{\"count\":1,\"status\":\"freshnessStatus.stale\"}")).toBeTruthy();
    expect(screen.getByText("staleEvidenceDetail:{\"refs\":\"note 00000000/job 00000000\"}")).toBeTruthy();
    expect(screen.getByText(
      "verificationSummary:{\"status\":\"verificationStatus.blocked\",\"code\":\"recoveryCode.stale_context\"}",
    )).toBeTruthy();
  });

  it("does not query or render when there is no active project", () => {
    const { container } = renderWithClient(null);

    expect(container.firstChild).toBeNull();
    expect(workflowConsoleApi.list).not.toHaveBeenCalled();
  });
});
