import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { workflowConsoleApi, type WorkflowConsoleRun } from "@/lib/api-client";

import { WorkflowConsoleRuns } from "./workflow-console-runs";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => {
    if (!values) return key;
    return `${key}:${JSON.stringify(values)}`;
  },
}));

vi.mock("@/lib/api-client", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/api-client")>(
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
    agentRole: "organize",
    workGroupId: "import:00000000-0000-4000-8000-000000000050",
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
    expect(screen.getByText('progress:{"percent":80}')).toBeTruthy();
    expect(screen.getByText("vault.zip")).toBeTruthy();
    expect(
      screen.getByText("Import could not be started. Please try again."),
    ).toBeTruthy();
    expect(workflowConsoleApi.list).toHaveBeenCalledWith(projectId, 5);
  });

  it("surfaces active work as a user-facing agent role instead of an internal run type", async () => {
    vi.mocked(workflowConsoleApi.list).mockResolvedValue({
      runs: [
        run({
          runId: "chat:00000000-0000-4000-8000-000000000090",
          runType: "chat",
          agentRole: "research",
          workGroupId: "chat:00000000-0000-4000-8000-000000000090",
          title: "Research source citations",
          status: "running",
          sourceStatus: "running",
          progress: { current: 1, total: 3, percent: 33 },
          error: null,
          outputs: [],
        }),
      ],
    });

    renderWithClient();

    expect(await screen.findAllByText("Research source citations")).toHaveLength(
      2,
    );
    expect(screen.getAllByText("role.research").length).toBeGreaterThan(0);
    expect(
      screen.getByText(
        'activeRole:{"role":"role.research","status":"status.running"}',
      ),
    ).toBeTruthy();
  });

  it("renders an active work queue and role handoff timeline for multi-step agent work", async () => {
    vi.mocked(workflowConsoleApi.list).mockResolvedValue({
      runs: [
        run({
          runId: "export:00000000-0000-4000-8000-000000000102",
          runType: "export",
          agentRole: "export",
          workGroupId: "chat:00000000-0000-4000-8000-000000000100",
          title: "Export pdf report",
          status: "queued",
          progress: null,
          error: null,
          outputs: [],
        }),
        run({
          runId: "agent_action:00000000-0000-4000-8000-000000000101",
          runType: "agent_action",
          agentRole: "review",
          workGroupId: "chat:00000000-0000-4000-8000-000000000100",
          title: "Review note update",
          status: "approval_required",
          progress: null,
          error: null,
          approvals: [
            {
              approvalId: "00000000-0000-4000-8000-000000000201",
              status: "requested",
              risk: "write",
            },
          ],
          outputs: [],
        }),
        run({
          runId: "chat:00000000-0000-4000-8000-000000000100",
          runType: "chat",
          agentRole: "research",
          workGroupId: "chat:00000000-0000-4000-8000-000000000100",
          title: "Research source citations",
          status: "completed",
          progress: null,
          error: null,
          outputs: [],
        }),
      ],
    });

    renderWithClient();

    expect(await screen.findByText("workQueueTitle")).toBeTruthy();
    expect(
      screen.getByText('queueItem:{"role":"role.export","status":"status.queued"}'),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'queueItem:{"role":"role.review","status":"status.approval_required"}',
      ),
    ).toBeTruthy();
    expect(screen.getByText("handoffTitle")).toBeTruthy();
    expect(screen.getAllByText("role.research").length).toBeGreaterThan(0);
    expect(screen.getAllByText("role.review").length).toBeGreaterThan(0);
    expect(screen.getAllByText("role.export").length).toBeGreaterThan(0);
  });

  it("does not build a handoff timeline from unrelated workflow groups", async () => {
    vi.mocked(workflowConsoleApi.list).mockResolvedValue({
      runs: [
        run({
          runId: "export:00000000-0000-4000-8000-000000000111",
          runType: "export",
          agentRole: "export",
          workGroupId: "export:00000000-0000-4000-8000-000000000111",
          title: "Export pdf report",
          status: "queued",
          progress: null,
          error: null,
          outputs: [],
        }),
        run({
          runId: "chat:00000000-0000-4000-8000-000000000112",
          runType: "chat",
          agentRole: "research",
          workGroupId: "chat:00000000-0000-4000-8000-000000000112",
          title: "Research source citations",
          status: "completed",
          progress: null,
          error: null,
          outputs: [],
        }),
      ],
    });

    renderWithClient();

    expect(await screen.findAllByText("Export pdf report")).toHaveLength(2);
    expect(screen.queryByText("handoffTitle")).toBeNull();
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
    expect(
      screen.getByText(
        'logSummary:{"packageManager":"pnpm","packages":"zod@3.25.0, @vitejs/plugin-react","exitCode":0}',
      ),
    ).toBeTruthy();
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
                    contentHash: "hash-old",
                    analysisVersion: 3,
                  },
                ],
                evidenceIssues: [
                  {
                    freshnessStatus: "stale",
                    recoveryCode: "stale_context",
                    verificationStatus: "blocked",
                    refs: [
                      {
                        type: "note_analysis_job",
                        noteId: "00000000-0000-4000-8000-000000000091",
                        jobId: "00000000-0000-4000-8000-000000000092",
                        contentHash: "hash-old",
                        analysisVersion: 3,
                      },
                    ],
                  },
                ],
              },
            },
          ],
        }),
      ],
    });

    renderWithClient();

    expect(await screen.findAllByText("Review stale evidence")).toHaveLength(2);
    expect(
      screen.getByText(
        'evidenceSummary:{"count":1,"status":"freshnessStatus.stale"}',
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'staleEvidenceDetail:{"refs":"note 00000000/job 00000000 v3 hash-old"}',
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'verificationSummary:{"status":"verificationStatus.blocked","code":"recoveryCode.stale_context"}',
      ),
    ).toBeTruthy();
  });

  it("renders missing evidence recovery state from evidence issue metadata", async () => {
    vi.mocked(workflowConsoleApi.list).mockResolvedValue({
      runs: [
        run({
          runId: "agentic_plan:00000000-0000-4000-8000-000000000081",
          runType: "agentic_plan",
          title: "Review missing evidence",
          status: "blocked",
          progress: { current: 0, total: 1, percent: 0 },
          error: {
            code: "missing_source",
            message: "Step evidence source is missing.",
            retryable: true,
          },
          outputs: [
            {
              outputType: "preview",
              id: "00000000-0000-4000-8000-000000000081",
              label: "1-step deterministic plan",
              metadata: {
                verificationStatus: "blocked",
                recoveryCodes: ["missing_source"],
                evidenceFreshness: { missing: 1 },
                evidenceIssues: [
                  {
                    freshnessStatus: "missing",
                    recoveryCode: "missing_source",
                    verificationStatus: "blocked",
                    refs: [],
                  },
                ],
              },
            },
          ],
        }),
      ],
    });

    renderWithClient();

    expect(await screen.findAllByText("Review missing evidence")).toHaveLength(2);
    expect(
      screen.getByText(
        'evidenceSummary:{"count":1,"status":"freshnessStatus.missing"}',
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'verificationSummary:{"status":"verificationStatus.blocked","code":"recoveryCode.missing_source"}',
      ),
    ).toBeTruthy();
  });

  it("does not query or render when there is no active project", () => {
    const { container } = renderWithClient(null);

    expect(container.firstChild).toBeNull();
    expect(workflowConsoleApi.list).not.toHaveBeenCalled();
  });
});
