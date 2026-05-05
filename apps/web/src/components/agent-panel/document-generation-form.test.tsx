import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DocumentGenerationForm } from "./document-generation-form";

vi.mock("next-intl", () => ({
  useTranslations: (ns?: string) => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${ns}.${key}:${JSON.stringify(vars)}` : `${ns}.${key}`,
}));

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  (globalThis as { fetch?: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
});

describe("DocumentGenerationForm", () => {
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
    fireEvent.click(screen.getByLabelText(/Planning note/));
    fireEvent.click(screen.getByLabelText(/Source PDF/));
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
});
