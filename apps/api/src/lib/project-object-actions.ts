import {
  type AgentFileCreatedEvent,
  type AgentFileSummary,
  type ProjectObjectAction,
  type ProjectObjectActionEvent,
  type ProjectObjectSummary,
} from "@opencairn/shared";
import {
  compileAgentFile,
  createAgentFile,
  createAgentFileVersion,
  exportAgentFileForDownload,
} from "./agent-files";

export interface ProjectObjectActionContext {
  userId: string;
  workspaceId: string;
  projectId: string;
  chatThreadId?: string | null;
  chatMessageId?: string | null;
}

export interface ProjectObjectActionDeps {
  createAgentFile: typeof createAgentFile;
  createAgentFileVersion: typeof createAgentFileVersion;
  compileAgentFile: typeof compileAgentFile;
  exportAgentFileForDownload: typeof exportAgentFileForDownload;
}

export interface ExecuteProjectObjectActionOptions {
  context: ProjectObjectActionContext;
  deps?: ProjectObjectActionDeps;
}

export interface ProjectObjectActionResult {
  event: ProjectObjectActionEvent;
  compatibilityEvent?: AgentFileCreatedEvent;
  file?: AgentFileSummary;
}

const defaultDeps: ProjectObjectActionDeps = {
  createAgentFile,
  createAgentFileVersion,
  compileAgentFile,
  exportAgentFileForDownload,
};

export async function executeProjectObjectAction(
  action: ProjectObjectAction,
  options: ExecuteProjectObjectActionOptions,
): Promise<ProjectObjectActionResult> {
  const deps = options.deps ?? defaultDeps;
  const { context } = options;

  switch (action.type) {
    case "create_project_object": {
      const file = await deps.createAgentFile({
        userId: context.userId,
        projectId: context.projectId,
        source: "agent_chat",
        ...(context.chatThreadId !== undefined ? { chatThreadId: context.chatThreadId } : {}),
        ...(context.chatMessageId !== undefined ? { chatMessageId: context.chatMessageId } : {}),
        file: action.object,
      });
      assertContextMatch(file, context);
      const object = toProjectObjectSummary(file);
      return {
        event: { type: "project_object_created", object },
        compatibilityEvent: { type: "agent_file_created", file },
        file,
      };
    }
    case "update_project_object_content": {
      const file = await deps.createAgentFileVersion({
        userId: context.userId,
        id: action.objectId,
        file: {
          ...(action.filename !== undefined ? { filename: action.filename } : {}),
          ...(action.title !== undefined ? { title: action.title } : {}),
          ...(action.content !== undefined ? { content: action.content } : {}),
          ...(action.base64 !== undefined ? { base64: action.base64 } : {}),
          ...(action.startIngest !== undefined ? { startIngest: action.startIngest } : {}),
        },
      });
      assertContextMatch(file, context);
      return {
        event: {
          type: "project_object_updated",
          object: toProjectObjectSummary(file),
        },
        file,
      };
    }
    case "compile_project_object":
      await deps.compileAgentFile(action.objectId, context.userId);
      return {
        event: {
          type: "project_object_compile_requested",
          objectId: action.objectId,
          target: action.target,
        },
      };
    case "export_project_object": {
      const exported = await deps.exportAgentFileForDownload(
        action.objectId,
        context.userId,
      );
      assertContextMatch(exported.file, context);

      if (action.provider === "opencairn_download") {
        return {
          event: {
            type: "project_object_export_ready",
            object: toProjectObjectSummary(exported.file),
            provider: "opencairn_download",
            format: action.format,
            downloadUrl: exported.downloadUrl,
            filename: exported.filename,
            mimeType: exported.mimeType,
            bytes: exported.bytes,
          },
          file: exported.file,
        };
      }
      return {
        event: {
          type: "project_object_export_requested",
          objectId: action.objectId,
          provider: action.provider,
          format: action.format,
        },
        file: exported.file,
      };
    }
  }
}

export function toProjectObjectSummary(file: AgentFileSummary): ProjectObjectSummary {
  return {
    id: file.id,
    objectType: "agent_file",
    title: file.title,
    filename: file.filename,
    kind: file.kind,
    mimeType: file.mimeType,
    projectId: file.projectId,
  };
}

function assertContextMatch(file: AgentFileSummary, context: ProjectObjectActionContext): void {
  if (file.workspaceId !== context.workspaceId || file.projectId !== context.projectId) {
    throw new Error("project_object_context_mismatch");
  }
}
