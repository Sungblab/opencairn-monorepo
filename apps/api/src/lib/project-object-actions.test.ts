import { describe, expect, it, vi } from "vitest";
import type { AgentFileSummary } from "@opencairn/shared";
import { executeProjectObjectAction } from "./project-object-actions";

const userId = "00000000-0000-4000-8000-000000000001";
const workspaceId = "00000000-0000-4000-8000-000000000002";
const projectId = "00000000-0000-4000-8000-000000000003";
const fileId = "00000000-0000-4000-8000-000000000004";

const summary: AgentFileSummary = {
  id: fileId,
  workspaceId,
  projectId,
  folderId: null,
  title: "Brief",
  filename: "brief.md",
  extension: "md",
  kind: "markdown",
  mimeType: "text/markdown",
  bytes: 7,
  source: "agent_chat",
  versionGroupId: "00000000-0000-4000-8000-000000000005",
  version: 1,
  ingestWorkflowId: null,
  ingestStatus: "not_started",
  sourceNoteId: null,
  canvasNoteId: null,
  compileStatus: "not_started",
  compiledMimeType: null,
  createdAt: "2026-05-04T00:00:00.000Z",
  updatedAt: "2026-05-04T00:00:00.000Z",
};

describe("executeProjectObjectAction", () => {
  it("routes create_project_object through agent file creation", async () => {
    const createAgentFile = vi.fn().mockResolvedValue(summary);

    const result = await executeProjectObjectAction(
      {
        type: "create_project_object",
        object: {
          filename: "brief.md",
          kind: "markdown",
          mimeType: "text/markdown",
          content: "# Brief",
        },
      },
      {
        context: { userId, workspaceId, projectId },
        deps: {
          createAgentFile,
          createAgentFileVersion: vi.fn(),
          compileAgentFile: vi.fn(),
          exportAgentFileForDownload: vi.fn(),
        },
      },
    );

    expect(createAgentFile).toHaveBeenCalledWith({
      userId,
      projectId,
      source: "agent_chat",
      file: {
        filename: "brief.md",
        kind: "markdown",
        mimeType: "text/markdown",
        content: "# Brief",
      },
    });
    expect(result.event.type).toBe("project_object_created");
    expect(result.compatibilityEvent?.type).toBe("agent_file_created");
  });

  it("routes update and compile actions through existing agent file helpers", async () => {
    const createAgentFileVersion = vi.fn().mockResolvedValue({ ...summary, version: 2 });
    const compileAgentFile = vi.fn().mockResolvedValue({ ...summary, compileStatus: "completed" });

    const deps = {
      createAgentFile: vi.fn(),
      createAgentFileVersion,
      compileAgentFile,
      exportAgentFileForDownload: vi.fn(),
    };

    const update = await executeProjectObjectAction(
      {
        type: "update_project_object_content",
        objectId: fileId,
        content: "updated",
      },
      { context: { userId, workspaceId, projectId }, deps },
    );

    expect(createAgentFileVersion).toHaveBeenCalledWith({
      userId,
      id: fileId,
      file: { content: "updated" },
    });
    expect(update.event.type).toBe("project_object_updated");

    const compile = await executeProjectObjectAction(
      { type: "compile_project_object", objectId: fileId, target: "pdf" },
      { context: { userId, workspaceId, projectId }, deps },
    );

    expect(compileAgentFile).toHaveBeenCalledWith(fileId, userId);
    expect(compile.event.type).toBe("project_object_compile_requested");
  });

  it("keeps generate_project_object as a typed worker handoff skeleton", async () => {
    const requestId = "00000000-0000-4000-8000-000000000020";
    const deps = {
      createAgentFile: vi.fn(),
      createAgentFileVersion: vi.fn(),
      compileAgentFile: vi.fn(),
      exportAgentFileForDownload: vi.fn(),
    };

    const result = await executeProjectObjectAction(
      {
        type: "generate_project_object",
        requestId,
        generation: {
          format: "pdf",
          prompt: "Generate a polished project report.",
          locale: "ko",
          template: "report",
          sources: [
            {
              type: "agent_file",
              objectId: fileId,
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
      { context: { userId, workspaceId, projectId }, deps },
    );

    expect(deps.createAgentFile).not.toHaveBeenCalled();
    expect(deps.exportAgentFileForDownload).not.toHaveBeenCalled();
    expect(result.event).toEqual({
      type: "project_object_generation_requested",
      requestId,
      workflowHint: "document_generation",
      generation: {
        format: "pdf",
        prompt: "Generate a polished project report.",
        locale: "ko",
        template: "report",
        sources: [
          {
            type: "agent_file",
            objectId: fileId,
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
    });
  });

  it("turns opencairn_download export_project_object into a stored file download event", async () => {
    const exportAgentFileForDownload = vi.fn().mockResolvedValue({
      file: summary,
      downloadUrl: `/api/agent-files/${fileId}/file`,
      filename: "brief.md",
      mimeType: "text/markdown",
      bytes: 7,
    });

    const result = await executeProjectObjectAction(
      {
        type: "export_project_object",
        objectId: fileId,
        format: "pdf",
        provider: "opencairn_download",
      },
      {
        context: { userId, workspaceId, projectId },
        deps: {
          createAgentFile: vi.fn(),
          createAgentFileVersion: vi.fn(),
          compileAgentFile: vi.fn(),
          exportAgentFileForDownload,
        },
      },
    );

    expect(exportAgentFileForDownload).toHaveBeenCalledWith(fileId, userId);
    expect(result.event).toEqual({
      type: "project_object_export_ready",
      object: {
        id: fileId,
        objectType: "agent_file",
        title: "Brief",
        filename: "brief.md",
        kind: "markdown",
        mimeType: "text/markdown",
        projectId,
      },
      provider: "opencairn_download",
      format: "markdown",
      downloadUrl: `/api/agent-files/${fileId}/file`,
      filename: "brief.md",
      mimeType: "text/markdown",
      bytes: 7,
    });
  });

  it("keeps provider export as an optional gated skeleton event", async () => {
    const exportAgentFileForDownload = vi.fn().mockResolvedValue({
      file: summary,
      downloadUrl: `/api/agent-files/${fileId}/file`,
      filename: "brief.md",
      mimeType: "text/markdown",
      bytes: 7,
    });

    const result = await executeProjectObjectAction(
      {
        type: "export_project_object",
        objectId: fileId,
        format: "docx",
        provider: "google_drive",
      },
      {
        context: { userId, workspaceId, projectId },
        deps: {
          createAgentFile: vi.fn(),
          createAgentFileVersion: vi.fn(),
          compileAgentFile: vi.fn(),
          exportAgentFileForDownload,
        },
      },
    );

    expect(exportAgentFileForDownload).toHaveBeenCalledWith(fileId, userId);
    expect(result.event).toEqual({
      type: "project_object_export_requested",
      objectId: fileId,
      provider: "google_drive",
      format: "docx",
    });
  });
});
