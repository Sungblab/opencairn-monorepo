import { describe, expect, it } from "vitest";
import {
  documentGenerationTerminalResultSchema,
  projectObjectActionSchema,
  projectObjectActionEventSchema,
} from "../src/project-object-actions";

const projectObjectId = "00000000-0000-4000-8000-000000000010";
const generationRequestId = "00000000-0000-4000-8000-000000000020";

describe("project object action contracts", () => {
  it("accepts a typed create action without caller-supplied workspace or user scope", () => {
    const parsed = projectObjectActionSchema.parse({
      type: "create_project_object",
      requestId: "00000000-0000-4000-8000-000000000001",
      object: {
        filename: "brief.md",
        kind: "markdown",
        mimeType: "text/markdown",
        content: "# Brief",
      },
    });

    expect(parsed.type).toBe("create_project_object");
    expect("workspaceId" in parsed).toBe(false);
    expect("userId" in parsed).toBe(false);
    expect("projectId" in parsed).toBe(false);
  });

  it("accepts update, export, and compile actions", () => {
    expect(
      projectObjectActionSchema.parse({
        type: "update_project_object_content",
        objectId: projectObjectId,
        content: "updated",
      }).type,
    ).toBe("update_project_object_content");

    expect(
      projectObjectActionSchema.parse({
        type: "export_project_object",
        objectId: projectObjectId,
        format: "pdf",
        provider: "opencairn_download",
      }).type,
    ).toBe("export_project_object");

    expect(
      projectObjectActionSchema.parse({
        type: "compile_project_object",
        objectId: projectObjectId,
        target: "pdf",
      }).type,
    ).toBe("compile_project_object");

    expect(
      projectObjectActionSchema.parse({
        type: "generate_project_object",
        requestId: generationRequestId,
        generation: {
          format: "docx",
          prompt: "Create a customer-ready implementation brief.",
          template: "brief",
          sources: [
            {
              type: "note",
              noteId: "00000000-0000-4000-8000-000000000021",
            },
            {
              type: "chat_thread",
              threadId: "00000000-0000-4000-8000-000000000022",
              messageIds: ["00000000-0000-4000-8000-000000000023"],
            },
          ],
          destination: {
            filename: "implementation-brief.docx",
            title: "Implementation brief",
          },
        },
      }).type,
    ).toBe("generate_project_object");
  });

  it("rejects LLM-supplied scope fields on write actions", () => {
    expect(() =>
      projectObjectActionSchema.parse({
        type: "create_project_object",
        workspaceId: "00000000-0000-4000-8000-000000000002",
        object: {
          filename: "brief.md",
          content: "# Brief",
        },
      }),
    ).toThrow();

    expect(() =>
      projectObjectActionSchema.parse({
        type: "update_project_object_content",
        objectId: projectObjectId,
        projectId: "00000000-0000-4000-8000-000000000003",
        content: "updated",
      }),
    ).toThrow();
  });

  it("rejects caller-supplied scope in document generation specs", () => {
    expect(() =>
      projectObjectActionSchema.parse({
        type: "generate_project_object",
        generation: {
          workspaceId: "00000000-0000-4000-8000-000000000099",
          format: "pdf",
          prompt: "Generate a PDF report.",
          destination: {
            filename: "report.pdf",
          },
        },
      }),
    ).toThrow();

    expect(() =>
      projectObjectActionSchema.parse({
        type: "generate_project_object",
        generation: {
          format: "pptx",
          prompt: "Generate slides.",
          sources: [
            {
              type: "note",
              noteId: "00000000-0000-4000-8000-000000000021",
              userId: "user-1",
            },
          ],
          destination: {
            filename: "deck.pptx",
          },
        },
      }),
    ).toThrow();
  });

  it("describes a typed project object creation event", () => {
    const parsed = projectObjectActionEventSchema.parse({
      type: "project_object_created",
      object: {
        id: projectObjectId,
        objectType: "agent_file",
        title: "Brief",
        filename: "brief.md",
        kind: "markdown",
        mimeType: "text/markdown",
        projectId: "00000000-0000-4000-8000-000000000011",
      },
    });

    expect(parsed.object.objectType).toBe("agent_file");
  });

  it("describes an OpenCairn download export-ready event", () => {
    const parsed = projectObjectActionEventSchema.parse({
      type: "project_object_export_ready",
      object: {
        id: projectObjectId,
        objectType: "agent_file",
        title: "Brief",
        filename: "brief.md",
        kind: "markdown",
        mimeType: "text/markdown",
        projectId: "00000000-0000-4000-8000-000000000011",
      },
      provider: "opencairn_download",
      downloadUrl: `/api/agent-files/${projectObjectId}/file`,
      filename: "brief.md",
      mimeType: "text/markdown",
      bytes: 42,
    });

    expect(parsed.type).toBe("project_object_export_ready");
    expect(parsed.downloadUrl).toBe(`/api/agent-files/${projectObjectId}/file`);
  });

  it("describes document generation request and terminal result events", () => {
    const requested = projectObjectActionEventSchema.parse({
      type: "project_object_generation_requested",
      requestId: generationRequestId,
      workflowHint: "document_generation",
      generation: {
        format: "xlsx",
        prompt: "Create a budget workbook from the research data.",
        template: "spreadsheet",
        locale: "ko",
        sources: [
          {
            type: "research_run",
            runId: "00000000-0000-4000-8000-000000000031",
          },
        ],
        destination: {
          filename: "budget.xlsx",
          publishAs: "agent_file",
          startIngest: true,
        },
      },
    });

    expect(requested.generation.artifactMode).toBe("object_storage");
    expect(requested.generation.destination.publishAs).toBe("agent_file");

    const completed = documentGenerationTerminalResultSchema.parse({
      ok: true,
      requestId: generationRequestId,
      workflowId: "document-generation/00000000-0000-4000-8000-000000000020",
      format: "xlsx",
      object: {
        id: projectObjectId,
        objectType: "agent_file",
        title: "Budget",
        filename: "budget.xlsx",
        kind: "xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        projectId: "00000000-0000-4000-8000-000000000011",
      },
      artifact: {
        objectKey: "agent-files/project/budget.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        bytes: 12345,
      },
    });

    expect(completed.ok).toBe(true);
  });

  it("accepts report templates and selectable PDF render engines", () => {
    const latex = projectObjectActionSchema.parse({
      type: "generate_project_object",
      requestId: generationRequestId,
      generation: {
        format: "pdf",
        prompt: "Create a technical report with figures and citations.",
        template: "technical_report",
        renderEngine: "latex",
        destination: {
          filename: "technical-report.pdf",
        },
      },
    });

    expect(latex.type).toBe("generate_project_object");
    expect(latex.generation.template).toBe("technical_report");
    expect(latex.generation.renderEngine).toBe("latex");

    const fastPdf = projectObjectActionSchema.parse({
      type: "generate_project_object",
      requestId: generationRequestId,
      generation: {
        format: "pdf",
        prompt: "Create a quick business summary.",
        template: "business_report",
        renderEngine: "pymupdf",
        destination: {
          filename: "business-report.pdf",
        },
      },
    });

    expect(fastPdf.type).toBe("generate_project_object");
    expect(fastPdf.generation.template).toBe("business_report");
    expect(fastPdf.generation.renderEngine).toBe("pymupdf");

    expect(() =>
      projectObjectActionSchema.parse({
        type: "generate_project_object",
        generation: {
          format: "docx",
          prompt: "DOCX should not accept a PDF render engine.",
          renderEngine: "latex",
          destination: {
            filename: "brief.docx",
          },
        },
      }),
    ).toThrow();
  });

  it("accepts image figure generation without a PDF render engine", () => {
    const figure = projectObjectActionSchema.parse({
      type: "generate_project_object",
      requestId: generationRequestId,
      generation: {
        format: "image",
        prompt: "Create a source-aware strategy figure.",
        imageEngine: "model",
        template: "research_brief",
        destination: {
          filename: "strategy-figure.png",
        },
      },
    });

    expect(figure.type).toBe("generate_project_object");
    expect(figure.generation.format).toBe("image");
    expect(figure.generation.template).toBe("research_brief");
    expect(figure.generation.imageEngine).toBe("model");
    expect(figure.generation.renderEngine).toBeUndefined();

    expect(() =>
      projectObjectActionSchema.parse({
        type: "generate_project_object",
        generation: {
          format: "pdf",
          prompt: "PDF should not accept an image engine.",
          imageEngine: "model",
          destination: {
            filename: "brief.pdf",
          },
        },
      }),
    ).toThrow();
  });
});
