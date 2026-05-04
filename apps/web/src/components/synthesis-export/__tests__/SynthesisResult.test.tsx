import type React from "react";
import { beforeEach, describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { SynthesisResult } from "../SynthesisResult";
import type { SynthesisStreamState } from "../../../hooks/use-synthesis-stream";
import messages from "../../../../messages/ko/synthesis-export.json";
import { useTabsStore } from "../../../stores/tabs-store";

const { toastMock } = vi.hoisted(() => ({
  toastMock: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("sonner", () => ({
  toast: toastMock,
}));

function setup(
  state: SynthesisStreamState,
  runId = "run-1",
  onResynthesize = vi.fn(),
) {
  return render(
    <NextIntlClientProvider
      locale="ko"
      messages={{ synthesisExport: messages }}
    >
      <SynthesisResult
        runId={runId}
        state={state}
        onResynthesize={onResynthesize}
      />
    </NextIntlClientProvider>,
  );
}

const doneState: SynthesisStreamState = {
  status: "done",
  sourceCount: 5,
  tokensUsed: 1200,
  docUrl: "https://example.com/doc.md",
  format: "md",
  errorCode: null,
};

describe("SynthesisResult", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    useTabsStore.setState({
      workspaceId: "ws-1",
      tabs: [],
      activeId: null,
      closedStack: [],
    });
    Object.defineProperty(global, "crypto", {
      value: { randomUUID: () => "tab-id" },
      configurable: true,
    });
    global.fetch = vi.fn();
  });

  it("renders download anchor with correct href when done with format md", () => {
    setup(doneState);
    const anchor = screen.getByRole("link");
    expect(anchor.getAttribute("href")).toContain(
      "/api/synthesis-export/runs/run-1/document?format=md",
    );
  });

  it("returns null (no anchor) when status is not done", () => {
    setup({ ...doneState, status: "synthesizing" });
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("returns null (no anchor) when format is null", () => {
    setup({ ...doneState, format: null });
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("uses download.tex key for latex format", () => {
    setup({ ...doneState, format: "latex" });
    expect(screen.getByText(/\.tex 다운로드/)).toBeDefined();
  });

  it("publishes the completed document as a project file and opens the returned agent_file tab", async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        file: {
          id: "file-1",
          workspaceId: "ws-1",
          projectId: "project-1",
          folderId: null,
          title: "Draft report",
          filename: "draft.md",
          extension: "md",
          kind: "markdown",
          mimeType: "text/markdown",
          bytes: 120,
          source: "synthesis_export",
          versionGroupId: "version-1",
          version: 1,
          ingestWorkflowId: null,
          ingestStatus: "not_started",
          sourceNoteId: null,
          canvasNoteId: null,
          compileStatus: "not_started",
          compiledMimeType: null,
          createdAt: "2026-05-04T00:00:00.000Z",
          updatedAt: "2026-05-04T00:00:00.000Z",
        },
      }),
    } as Response);

    setup(doneState);
    fireEvent.click(screen.getByRole("button", { name: "프로젝트에 추가" }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/synthesis-export/runs/run-1/project-object",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ format: "md" }),
        }),
      );
    });

    await waitFor(() => {
      expect(useTabsStore.getState().tabs).toEqual([
        expect.objectContaining({
          kind: "agent_file",
          targetId: "file-1",
          title: "Draft report",
          mode: "agent-file",
          preview: false,
        }),
      ]);
    });
    expect(toastMock.success).toHaveBeenCalledWith("프로젝트에 추가했습니다.");
  });

  it("shows an error toast when project file publishing fails", async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: "missing_project" }),
    } as Response);

    setup(doneState);
    fireEvent.click(screen.getByRole("button", { name: "프로젝트에 추가" }));

    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalledWith(
        "프로젝트에 추가하지 못했습니다. 다시 시도해 주세요.",
      );
    });
    expect(useTabsStore.getState().tabs).toEqual([]);
  });
});
