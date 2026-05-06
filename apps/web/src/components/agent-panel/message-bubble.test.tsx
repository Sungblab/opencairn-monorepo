import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useTabsStore } from "@/stores/tabs-store";

import {
  DocumentGenerationCards,
  asDocumentGenerationCards,
} from "./message-bubble";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => {
    if (!values) return key;
    return `${key}:${JSON.stringify(values)}`;
  },
}));

const requestId = "00000000-0000-4000-8000-000000000020";
const objectId = "00000000-0000-4000-8000-000000000010";
const projectId = "00000000-0000-4000-8000-000000000003";

describe("document generation cards", () => {
  beforeEach(() => {
    useTabsStore.setState(useTabsStore.getInitialState(), true);
    useTabsStore.getState().setWorkspace("ws-test");
  });

  it("normalizes requested, running, completed, and failed generation events", () => {
    const cards = asDocumentGenerationCards([
      {
        type: "project_object_generation_requested",
        requestId,
        workflowHint: "document_generation",
        generation: {
          format: "pdf",
          prompt: "Generate a report",
          locale: "ko",
          template: "report",
          sources: [
            { type: "note", noteId: "00000000-0000-4000-8000-000000000030" },
            {
              type: "agent_file",
              objectId: "00000000-0000-4000-8000-000000000031",
            },
            {
              type: "chat_thread",
              threadId: "00000000-0000-4000-8000-000000000032",
            },
            {
              type: "research_run",
              runId: "00000000-0000-4000-8000-000000000033",
            },
            {
              type: "synthesis_run",
              runId: "00000000-0000-4000-8000-000000000034",
            },
          ],
          destination: {
            filename: "project-report.pdf",
            title: "Project report",
            publishAs: "agent_file",
            startIngest: false,
          },
          artifactMode: "object_storage",
        },
      },
      {
        type: "project_object_generation_status",
        requestId,
        status: "running",
      },
      {
        type: "project_object_generation_completed",
        result: {
          ok: true,
          requestId,
          workflowId: `document-generation/${requestId}`,
          format: "pdf",
          object: {
            id: objectId,
            objectType: "agent_file",
            title: "Project report",
            filename: "project-report.pdf",
            kind: "pdf",
            mimeType: "application/pdf",
            projectId,
          },
          artifact: {
            objectKey: "agent-files/project/project-report.pdf",
            mimeType: "application/pdf",
            bytes: 12345,
          },
          sourceQuality: {
            signals: ["metadata_fallback", "no_extracted_text"],
            sources: [
              {
                id: "00000000-0000-4000-8000-000000000031",
                kind: "agent_file",
                title: "Scanned PDF",
                signals: ["no_extracted_text"],
              },
            ],
          },
        },
      },
      {
        type: "project_object_generation_failed",
        result: {
          ok: false,
          requestId: "00000000-0000-4000-8000-000000000021",
          workflowId: "document-generation/failed",
          format: "docx",
          errorCode: "document_generation_failed",
          retryable: true,
        },
      },
    ]);

    expect(cards).toEqual([
      expect.objectContaining({
        requestId,
        status: "completed",
        format: "pdf",
        title: "Project report",
        filename: "project-report.pdf",
        file: expect.objectContaining({ id: objectId, kind: "pdf" }),
        qualitySignals: ["metadata_fallback", "no_extracted_text"],
        qualitySources: [
          expect.objectContaining({
            id: "00000000-0000-4000-8000-000000000031",
            kind: "agent_file",
            title: "Scanned PDF",
            signals: ["no_extracted_text"],
          }),
        ],
        sourceKinds: [
          "note",
          "agent_file",
          "chat_thread",
          "research_run",
          "synthesis_run",
        ],
      }),
      expect.objectContaining({
        requestId: "00000000-0000-4000-8000-000000000021",
        status: "failed",
        format: "docx",
        errorCode: "document_generation_failed",
      }),
    ]);
  });

  it("opens a completed generation result in the agent_file tab viewer", async () => {
    const user = userEvent.setup();
    const cards = asDocumentGenerationCards([
      {
        type: "project_object_generation_completed",
        result: {
          ok: true,
          requestId,
          workflowId: `document-generation/${requestId}`,
          format: "pdf",
          object: {
            id: objectId,
            objectType: "agent_file",
            title: "Project report",
            filename: "project-report.pdf",
            kind: "pdf",
            mimeType: "application/pdf",
            projectId,
          },
          artifact: {
            objectKey: "agent-files/project/project-report.pdf",
            mimeType: "application/pdf",
            bytes: 12345,
          },
        },
      },
    ]);

    render(<DocumentGenerationCards items={cards} />);
    await user.click(screen.getByRole("button", { name: /open/ }));

    expect(useTabsStore.getState().tabs).toEqual([
      expect.objectContaining({
        kind: "agent_file",
        targetId: objectId,
        title: "Project report",
        mode: "agent-file",
      }),
    ]);
    expect(screen.getByRole("link", { name: /download/ })).toHaveAttribute(
      "href",
      `/api/agent-files/${objectId}/file`,
    );
  });

  it("shows compact source quality signals without hiding the worker error code", () => {
    const cards = asDocumentGenerationCards([
      {
        type: "project_object_generation_completed",
        result: {
          ok: true,
          requestId,
          workflowId: `document-generation/${requestId}`,
          format: "pdf",
          object: {
            id: objectId,
            objectType: "agent_file",
            title: "Project report",
            filename: "project-report.pdf",
            kind: "pdf",
            mimeType: "application/pdf",
            projectId,
          },
          artifact: {
            objectKey: "agent-files/project/project-report.pdf",
            mimeType: "application/pdf",
            bytes: 12345,
          },
          sourceQuality: {
            signals: ["unsupported_source", "metadata_fallback"],
            sources: [
              {
                id: "00000000-0000-4000-8000-000000000031",
                kind: "agent_file",
                title: "Project report",
                signals: ["unsupported_source", "metadata_fallback"],
              },
            ],
          },
        },
      },
      {
        type: "project_object_generation_failed",
        result: {
          ok: false,
          requestId: "00000000-0000-4000-8000-000000000021",
          workflowId: "document-generation/failed",
          format: "docx",
          errorCode: "document_generation_failed",
          retryable: true,
          sourceQuality: {
            signals: ["source_corrupt"],
            sources: [],
          },
        },
      },
    ]);

    render(<DocumentGenerationCards items={cards} />);

    expect(screen.getByText(/qualitySignal.unsupported_source/)).toBeInTheDocument();
    expect(screen.getByText(/qualitySignal.metadata_fallback/)).toBeInTheDocument();
    expect(screen.getByText(/qualitySourceSummary/)).toHaveTextContent("Project report");
    expect(screen.getByText(/document_generation_failed/)).toBeInTheDocument();
  });
});
