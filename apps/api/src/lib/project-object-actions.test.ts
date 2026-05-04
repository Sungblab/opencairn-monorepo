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

  it("keeps export_project_object as a typed skeleton event", async () => {
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
        },
      },
    );

    expect(result.event).toEqual({
      type: "project_object_export_requested",
      objectId: fileId,
      provider: "opencairn_download",
      format: "pdf",
    });
  });
});
