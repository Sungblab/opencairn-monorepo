import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DocumentGenerationForm } from "./document-generation-form";
import { getDocumentGenerationPreset } from "./tool-discovery-catalog";

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: (ns?: string) => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${ns}.${key}:${JSON.stringify(vars)}` : `${ns}.${key}`,
}));

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  (globalThis as { fetch?: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
});

describe("DocumentGenerationForm", () => {
  it("opens with a document generation preset and consumes it once", async () => {
    const onEvent = vi.fn();
    const onPresetConsumed = vi.fn();
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/api/projects/project-1/document-generation/sources")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ sources: [] }),
        };
      }
      return { ok: false, status: 404, json: async () => ({ error: "not_found" }) };
    });

    render(
      <DocumentGenerationForm
        projectId="project-1"
        onEvent={onEvent}
        pendingPreset={getDocumentGenerationPreset("pdf_report_latex")}
        onPresetConsumed={onPresetConsumed}
      />,
    );

    await waitFor(() => expect(onPresetConsumed).toHaveBeenCalledOnce());
    expect(screen.getByLabelText(/format/)).toHaveValue("pdf");
    expect(screen.getByLabelText(/template/)).toHaveValue("paper_style");
    expect(screen.getByLabelText(/render engine/)).toHaveValue("latex");
    expect(screen.getByLabelText(/prompt/)).toHaveValue(
      "agentPanel.documentGeneration.presetPrompt.pdfReportLatex",
    );
    expect(screen.getByLabelText(/filename/)).toHaveValue(
      "agentPanel.documentGeneration.presetFilename.pdfReportLatex",
    );
  });

  it("opens the figure preset with image mode and figure-specific copy", async () => {
    const onPresetConsumed = vi.fn();
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/api/projects/project-1/document-generation/sources")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ sources: [] }),
        };
      }
      return { ok: false, status: 404, json: async () => ({ error: "not_found" }) };
    });

    render(
      <DocumentGenerationForm
        projectId="project-1"
        onEvent={vi.fn()}
        pendingPreset={getDocumentGenerationPreset("source_figure")}
        onPresetConsumed={onPresetConsumed}
      />,
    );

    await waitFor(() => expect(onPresetConsumed).toHaveBeenCalledOnce());
    expect(screen.getByRole("button", { name: /toggleFigure/ })).toBeInTheDocument();
    expect(screen.getByLabelText(/format/)).toHaveValue("image");
    expect(screen.getByLabelText(/template/)).toHaveValue("research_brief");
    expect(screen.getByLabelText(/image engine/)).toHaveValue("svg");
    expect(
      screen.getByPlaceholderText(
        "agentPanel.documentGeneration.figurePromptPlaceholder",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("agentPanel.documentGeneration.figureSourceRequired"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /submitFigure/ })).toBeDisabled();
  });

  it("resets selected sources when a new preset is applied", async () => {
    const onPresetConsumed = vi.fn();
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
                title: "Planning note",
                subtitle: "note",
                source: { type: "note", noteId: "00000000-0000-4000-8000-000000000001" },
              },
            ],
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({ error: "not_found" }) };
    });

    const { rerender } = render(
      <DocumentGenerationForm
        projectId="project-1"
        onEvent={vi.fn()}
        pendingPreset={getDocumentGenerationPreset("pdf_report_fast")}
        onPresetConsumed={onPresetConsumed}
      />,
    );

    await waitFor(() => expect(screen.getByText("Planning note")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText(/Planning note/));
    expect(
      screen.getByText(
        'agentPanel.documentGeneration.selectedCount:{"count":1}',
      ),
    ).toBeInTheDocument();

    rerender(
      <DocumentGenerationForm
        projectId="project-1"
        onEvent={vi.fn()}
        pendingPreset={getDocumentGenerationPreset("source_figure")}
        onPresetConsumed={onPresetConsumed}
      />,
    );

    await waitFor(() => expect(onPresetConsumed).toHaveBeenCalledTimes(2));
    expect(screen.getByText("agentPanel.documentGeneration.selectedNone")).toBeInTheDocument();
    expect(screen.getByLabelText(/Planning note/)).not.toBeChecked();
    expect(screen.getByLabelText(/prompt/)).toHaveValue(
      "agentPanel.documentGeneration.presetPrompt.sourceFigure",
    );
  });

  it("loads source options and submits generate_project_object with selected sources", async () => {
    const onEvent = vi.fn();
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/api/projects/project-1/document-generation/sources")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            sources: [
              {
                id: "note:n1",
                type: "note",
                title: "Planning note",
                subtitle: "note",
                source: { type: "note", noteId: "00000000-0000-4000-8000-000000000001" },
              },
              {
                id: "agent_file:f1",
                type: "agent_file",
                title: "Source PDF",
                subtitle: "source.pdf",
                source: { type: "agent_file", objectId: "00000000-0000-4000-8000-000000000002" },
                qualitySignals: ["metadata_fallback"],
              },
            ],
          }),
        };
      }
      if (url.endsWith("/api/projects/project-1/project-object-actions/generate")) {
        const payload = JSON.parse(String(init?.body));
        expect(payload).toMatchObject({
          type: "generate_project_object",
          generation: {
            format: "docx",
            prompt: "Make a product brief",
            locale: "en",
            template: "report",
            sources: [
              { type: "note", noteId: "00000000-0000-4000-8000-000000000001" },
              { type: "agent_file", objectId: "00000000-0000-4000-8000-000000000002" },
            ],
            destination: {
              filename: "brief.docx",
              publishAs: "agent_file",
              startIngest: false,
            },
            artifactMode: "object_storage",
          },
        });
        return {
          ok: true,
          status: 202,
          json: async () => ({
            action: { id: "action-1", status: "queued" },
            event: {
              type: "project_object_generation_requested",
              requestId: payload.requestId,
              generation: payload.generation,
              workflowHint: "document_generation",
            },
            workflowId: "document-generation/run-1",
            idempotent: false,
          }),
        };
      }
      if (url.endsWith("/api/agent-actions/action-1")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            action: {
              id: "action-1",
              status: "queued",
              result: null,
              errorCode: null,
            },
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({ error: "not_found" }) };
    });

    render(<DocumentGenerationForm projectId="project-1" onEvent={onEvent} />);

    fireEvent.click(screen.getByRole("button", { name: /toggle/ }));
    await waitFor(() => expect(screen.getByText("Planning note")).toBeInTheDocument());
    expect(screen.getByText("agentPanel.documentGeneration.sourceRequired")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /submit/ })).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/Planning note/));
    fireEvent.click(screen.getByLabelText(/Source PDF/));
    expect(
      screen.getByText(
        'agentPanel.documentGeneration.selectedCount:{"count":2}',
      ),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/prompt/), {
      target: { value: "Make a product brief" },
    });
    fireEvent.change(screen.getByLabelText(/filename/), {
      target: { value: "brief.docx" },
    });
    fireEvent.change(screen.getByLabelText(/format/), {
      target: { value: "docx" },
    });
    fireEvent.click(screen.getByRole("button", { name: /submit/ }));

    await waitFor(() =>
      expect(onEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: "project_object_generation_requested" }),
      ),
    );
  });

  it("submits selected PDF render engine and report template", async () => {
    const onEvent = vi.fn();
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/api/projects/project-1/document-generation/sources")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            sources: [
              {
                id: "note:n1",
                type: "note",
                title: "Planning note",
                subtitle: "note",
                source: { type: "note", noteId: "00000000-0000-4000-8000-000000000001" },
              },
            ],
          }),
        };
      }
      if (url.endsWith("/api/projects/project-1/project-object-actions/generate")) {
        const payload = JSON.parse(String(init?.body));
        expect(payload).toMatchObject({
          type: "generate_project_object",
          generation: {
            format: "pdf",
            template: "paper_style",
            renderEngine: "latex",
            destination: {
              filename: "paper.pdf",
            },
          },
        });
        return {
          ok: true,
          status: 202,
          json: async () => ({
            action: { id: "action-1", status: "queued" },
            event: {
              type: "project_object_generation_requested",
              requestId: payload.requestId,
              generation: payload.generation,
              workflowHint: "document_generation",
            },
            workflowId: "document-generation/run-1",
            idempotent: false,
          }),
        };
      }
      if (url.endsWith("/api/agent-actions/action-1")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            action: {
              id: "action-1",
              status: "completed",
              result: { ok: true, requestId: "request-1" },
              errorCode: null,
            },
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({ error: "not_found" }) };
    });

    render(<DocumentGenerationForm projectId="project-1" onEvent={onEvent} />);

    fireEvent.click(screen.getByRole("button", { name: /toggle/ }));
    await waitFor(() => expect(screen.getByText("Planning note")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText(/Planning note/));
    fireEvent.change(screen.getByLabelText(/prompt/), {
      target: { value: "Make a paper-style report" },
    });
    fireEvent.change(screen.getByLabelText(/filename/), {
      target: { value: "paper.pdf" },
    });
    fireEvent.change(screen.getByLabelText(/template/), {
      target: { value: "paper_style" },
    });
    fireEvent.change(screen.getByLabelText(/render engine/), {
      target: { value: "latex" },
    });
    fireEvent.click(screen.getByRole("button", { name: /submit/ }));

    await waitFor(() =>
      expect(onEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: "project_object_generation_requested" }),
      ),
    );
  });

  it("uses format-specific default templates for office outputs", async () => {
    const onEvent = vi.fn();
    const submitted: unknown[] = [];
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/api/projects/project-1/document-generation/sources")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            sources: [
              {
                id: "note:n1",
                type: "note",
                title: "Planning note",
                subtitle: "note",
                source: { type: "note", noteId: "00000000-0000-4000-8000-000000000001" },
              },
            ],
          }),
        };
      }
      if (url.endsWith("/api/projects/project-1/project-object-actions/generate")) {
        const payload = JSON.parse(String(init?.body));
        submitted.push(payload.generation);
        return {
          ok: true,
          status: 202,
          json: async () => ({
            action: { id: "action-1", status: "queued" },
            event: {
              type: "project_object_generation_requested",
              requestId: payload.requestId,
              generation: payload.generation,
              workflowHint: "document_generation",
            },
            workflowId: "document-generation/run-1",
            idempotent: false,
          }),
        };
      }
      if (url.endsWith("/api/agent-actions/action-1")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            action: { id: "action-1", status: "completed", result: { ok: true }, errorCode: null },
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({ error: "not_found" }) };
    });

    render(<DocumentGenerationForm projectId="project-1" onEvent={onEvent} />);

    fireEvent.click(screen.getByRole("button", { name: /toggle/ }));
    await waitFor(() => expect(screen.getByText("Planning note")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText(/Planning note/));
    fireEvent.change(screen.getByLabelText(/prompt/), {
      target: { value: "Make a workbook" },
    });
    fireEvent.change(screen.getByLabelText(/format/), {
      target: { value: "xlsx" },
    });
    expect(screen.getByLabelText(/template/)).toHaveValue("spreadsheet");
    fireEvent.click(screen.getByRole("button", { name: /submit/ }));

    await waitFor(() =>
      expect(submitted).toEqual([
        expect.objectContaining({ format: "xlsx", template: "spreadsheet" }),
      ]),
    );
  });

  it("submits image figure generation with selected image engine", async () => {
    const onEvent = vi.fn();
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/api/projects/project-1/document-generation/sources")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            sources: [
              {
                id: "note:n1",
                type: "note",
                title: "Planning note",
                subtitle: "note",
                source: { type: "note", noteId: "00000000-0000-4000-8000-000000000001" },
              },
            ],
          }),
        };
      }
      if (url.endsWith("/api/projects/project-1/project-object-actions/generate")) {
        const payload = JSON.parse(String(init?.body));
        expect(payload).toMatchObject({
          type: "generate_project_object",
          generation: {
            format: "image",
            template: "research_brief",
            imageEngine: "model",
            destination: {
              filename: "evidence-map.png",
            },
          },
        });
        expect(payload.generation.renderEngine).toBeUndefined();
        return {
          ok: true,
          status: 202,
          json: async () => ({
            action: { id: "action-1", status: "queued" },
            event: {
              type: "project_object_generation_requested",
              requestId: payload.requestId,
              generation: payload.generation,
              workflowHint: "document_generation",
            },
            workflowId: "document-generation/run-1",
            idempotent: false,
          }),
        };
      }
      if (url.endsWith("/api/agent-actions/action-1")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            action: { id: "action-1", status: "queued", result: null, errorCode: null },
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({ error: "not_found" }) };
    });

    render(<DocumentGenerationForm projectId="project-1" onEvent={onEvent} />);

    fireEvent.click(screen.getByRole("button", { name: /toggle/ }));
    await waitFor(() => expect(screen.getByText("Planning note")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText(/Planning note/));
    fireEvent.change(screen.getByLabelText(/format/), {
      target: { value: "image" },
    });
    fireEvent.change(screen.getByLabelText(/template/), {
      target: { value: "research_brief" },
    });
    fireEvent.change(screen.getByLabelText(/image engine/), {
      target: { value: "model" },
    });
    fireEvent.change(screen.getByLabelText(/prompt/), {
      target: { value: "Make a figure from the evidence" },
    });
    fireEvent.change(screen.getByLabelText(/filename/), {
      target: { value: "evidence-map.png" },
    });
    fireEvent.click(screen.getByRole("button", { name: /submit/ }));

    await waitFor(() =>
      expect(onEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: "project_object_generation_requested" }),
      ),
    );
  });
});
