import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AgentWorkflowCard } from "./agent-workflow-card";

vi.mock("next-intl", () => ({
  useLocale: () => "ko",
  useTranslations:
    (ns?: string) => (key: string, vars?: Record<string, unknown>) =>
      vars ? `${ns}.${key}:${JSON.stringify(vars)}` : `${ns}.${key}`,
}));

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  (globalThis as { fetch?: typeof fetch }).fetch =
    fetchMock as unknown as typeof fetch;
});

describe("AgentWorkflowCard", () => {
  it("preselects the source and initializes document generation from a paper-analysis workflow payload", async () => {
    const onSubmitWorkflow = vi.fn();
    const initialPrompt =
      "테스트 PDF를 논문 읽기 기준으로 분석해 긴 분석 리포트를 만들어줘.";
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/api/projects/project-1/document-generation/sources")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            sources: [
              {
                id: "note:n1",
                type: "note",
                title: "테스트 PDF",
                subtitle: "source.pdf",
                source: {
                  type: "note",
                  noteId: "11111111-1111-4111-8111-111111111111",
                },
              },
              {
                id: "note:n2",
                type: "note",
                title: "다른 자료",
                subtitle: "other.pdf",
                source: {
                  type: "note",
                  noteId: "22222222-2222-4222-8222-222222222222",
                },
              },
            ],
          }),
        };
      }
      return {
        ok: false,
        status: 404,
        json: async () => ({ error: "not_found" }),
      };
    });

    render(
      <AgentWorkflowCard
        workflow={{
          id: "workflow-1",
          kind: "document_generation",
          toolId: "paper_analysis",
          i18nKey: "paperAnalysis",
          prompt: "doc.pdf를 분석해줘.",
          presetId: "pdf_report_fast",
          payload: {
            action: "source_paper_analysis",
            sourceIds: ["note:n1"],
            sourceTitle: "테스트 PDF",
            initialPrompt,
            initialFilename: "doc-paper-analysis.pdf",
          },
        }}
        projectId="project-1"
        workspaceId="workspace-1"
        onClose={vi.fn()}
        onSubmitWorkflow={onSubmitWorkflow}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText("테스트 PDF")).toBeInTheDocument(),
    );
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes[0]).toBeChecked();
    expect(checkboxes[1]).not.toBeChecked();
    expect(screen.getByDisplayValue(initialPrompt)).toBeInTheDocument();
    expect(
      screen.getByDisplayValue("doc-paper-analysis.pdf"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /submit/ }));

    expect(onSubmitWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "document_generation",
        toolId: "paper_analysis",
        payload: expect.objectContaining({
          action: "generate_project_object",
          generation: expect.objectContaining({
            format: "pdf",
            prompt: initialPrompt,
            locale: "ko",
            sources: [
              {
                type: "note",
                noteId: "11111111-1111-4111-8111-111111111111",
              },
            ],
            destination: expect.objectContaining({
              filename: "doc-paper-analysis.pdf",
              publishAs: "agent_file",
            }),
          }),
        }),
      }),
    );
  });
});
