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
      applyCodeProjectPreview: vi.fn(),
      applyCodeProjectInstall: vi.fn(),
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

function previewAction(): AgentAction {
  return {
    id: "00000000-0000-4000-8000-000000000030",
    requestId: "00000000-0000-4000-8000-000000000031",
    workspaceId: "00000000-0000-4000-8000-000000000012",
    projectId,
    actorUserId: "user-1",
    sourceRunId: null,
    kind: "code_project.preview",
    status: "approval_required",
    risk: "external",
    input: {
      codeWorkspaceId: "00000000-0000-4000-8000-000000000020",
      snapshotId: "00000000-0000-4000-8000-000000000021",
      mode: "static",
      entryPath: "index.html",
      reason: "Review generated app",
    },
    preview: {
      kind: "code_project.preview",
      approval: "hosted_preview",
      mode: "static",
      entryPath: "index.html",
      summary: "Create static preview for index.html",
      reason: "Review generated app",
    },
    result: null,
    errorCode: null,
    createdAt: "2026-05-05T00:00:00.000Z",
    updatedAt: "2026-05-05T00:00:00.000Z",
  };
}

function completedPreviewAction(): AgentAction {
  const action = previewAction();
  return {
    ...action,
    id: "00000000-0000-4000-8000-000000000040",
    status: "completed",
    result: {
      ok: true,
      kind: "code_project.preview",
      mode: "static",
      codeWorkspaceId: "00000000-0000-4000-8000-000000000020",
      snapshotId: "00000000-0000-4000-8000-000000000021",
      entryPath: "index.html",
      previewUrl: "/api/agent-actions/00000000-0000-4000-8000-000000000040/preview/index.html",
      assetsBaseUrl: "/api/agent-actions/00000000-0000-4000-8000-000000000040/preview/",
      expiresAt: "2026-05-06T00:00:00.000Z",
      browserSmoke: {
        ok: true,
        status: 200,
        url: "https://preview.example.com/index.html",
        bodyChars: 42,
        screenshotPath: "output/playwright/preview.png",
        checkedAt: "2026-05-06T00:01:00.000Z",
      },
    },
  };
}

function installAction(): AgentAction {
  return {
    id: "00000000-0000-4000-8000-000000000050",
    requestId: "00000000-0000-4000-8000-000000000051",
    workspaceId: "00000000-0000-4000-8000-000000000012",
    projectId,
    actorUserId: "user-1",
    sourceRunId: null,
    kind: "code_project.install",
    status: "approval_required",
    risk: "external",
    input: {
      codeWorkspaceId: "00000000-0000-4000-8000-000000000020",
      snapshotId: "00000000-0000-4000-8000-000000000021",
      packageManager: "pnpm",
      packages: [
        { name: "zod", version: "3.25.0", dev: false },
        { name: "@vitejs/plugin-react", dev: true },
      ],
      network: "required",
      reason: "Generated app needs runtime validation and Vite React plugin",
    },
    preview: {
      kind: "code_project.install",
      approval: "dependency_install",
      packageManager: "pnpm",
      packages: [
        { name: "zod", version: "3.25.0", dev: false },
        { name: "@vitejs/plugin-react", dev: true },
      ],
      summary: "Install zod and @vitejs/plugin-react",
    },
    result: null,
    errorCode: null,
    createdAt: "2026-05-05T00:00:00.000Z",
    updatedAt: "2026-05-05T00:00:00.000Z",
  };
}

function mockLists({
  patches = [draftAction()],
  pendingPreviews = [],
  completedPreviews = [],
  pendingInstalls = [],
}: {
  patches?: AgentAction[];
  pendingPreviews?: AgentAction[];
  completedPreviews?: AgentAction[];
  pendingInstalls?: AgentAction[];
} = {}) {
  vi.mocked(agentActionsApi.list).mockImplementation(async (_projectId, opts) => {
    if (!opts) return { actions: [] };
    if (opts.kind === "code_project.patch") return { actions: patches };
    if (opts.kind === "code_project.preview" && opts.status === "approval_required") {
      return { actions: pendingPreviews };
    }
    if (opts.kind === "code_project.preview" && opts.status === "completed") {
      return { actions: completedPreviews };
    }
    if (opts.kind === "code_project.install") return { actions: pendingInstalls };
    return { actions: [] };
  });
}

describe("CodeProjectActionReviewList", () => {
  beforeEach(() => {
    mockLists();
    vi.mocked(agentActionsApi.applyCodeProjectPatch).mockResolvedValue({
      action: { ...draftAction(), status: "completed" },
    });
    vi.mocked(agentActionsApi.applyCodeProjectPreview).mockResolvedValue({
      action: { ...previewAction(), status: "completed" },
    });
    vi.mocked(agentActionsApi.applyCodeProjectInstall).mockResolvedValue({
      action: { ...installAction(), status: "queued" },
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

  it("renders and applies a pending static preview action", async () => {
    mockLists({ patches: [], pendingPreviews: [previewAction()] });
    const user = userEvent.setup();
    renderWithClient();

    expect(await screen.findByText("previewTitle")).toBeTruthy();
    expect(screen.getByText("previewEntry:{\"entryPath\":\"index.html\"}")).toBeTruthy();
    expect(screen.getByText("Review generated app")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "previewApply" }));

    expect(agentActionsApi.applyCodeProjectPreview).toHaveBeenCalledWith(previewAction().id);
    await waitFor(() => expect(screen.getByText("previewApplied")).toBeTruthy());
  });

  it("renders a completed static preview link", async () => {
    mockLists({ patches: [], completedPreviews: [completedPreviewAction()] });
    renderWithClient();

    const link = await screen.findByRole("link", { name: "openPreview" });
    expect(link).toHaveAttribute(
      "href",
      "/api/agent-actions/00000000-0000-4000-8000-000000000040/preview/index.html",
    );
    expect(screen.getByText("previewEntry:{\"entryPath\":\"index.html\"}")).toBeTruthy();
    expect(screen.getByText("smokePassed:{\"status\":200}")).toBeTruthy();
    expect(
      screen.getByText("smokeScreenshot:{\"path\":\"output/playwright/preview.png\"}"),
    ).toBeTruthy();
  });

  it("prefers a signed public static preview link when present", async () => {
    const action = completedPreviewAction();
    action.result = {
      ...(action.result as Record<string, unknown>),
      publicPreviewUrl:
        "https://preview.example.com/api/public/agent-actions/00000000-0000-4000-8000-000000000040/preview/token/index.html",
      publicAssetsBaseUrl:
        "https://preview.example.com/api/public/agent-actions/00000000-0000-4000-8000-000000000040/preview/token/",
    };
    mockLists({ patches: [], completedPreviews: [action] });
    renderWithClient();

    const link = await screen.findByRole("link", { name: "openPreview" });
    expect(link).toHaveAttribute(
      "href",
      "https://preview.example.com/api/public/agent-actions/00000000-0000-4000-8000-000000000040/preview/token/index.html",
    );
  });

  it("renders and applies a pending dependency install action", async () => {
    mockLists({ patches: [], pendingInstalls: [installAction()] });
    const user = userEvent.setup();
    renderWithClient();

    expect(await screen.findByText("installTitle")).toBeTruthy();
    expect(screen.getByText("installPackageManager:{\"packageManager\":\"pnpm\"}")).toBeTruthy();
    expect(screen.getByText("zod@3.25.0, @vitejs/plugin-react")).toBeTruthy();
    expect(screen.getByText("Generated app needs runtime validation and Vite React plugin")).toBeTruthy();
    expect(screen.getByText("installNetworkWarning")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "installApply" }));

    expect(agentActionsApi.applyCodeProjectInstall).toHaveBeenCalledWith(installAction().id);
    await waitFor(() => expect(screen.getByText("installApplied")).toBeTruthy());
  });
});
