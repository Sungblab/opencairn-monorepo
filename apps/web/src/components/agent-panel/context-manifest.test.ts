import { describe, expect, it, vi } from "vitest";
import type { Tab } from "@/stores/tabs-store";

import {
  buildAgentContextPayload,
  getAgentInvocationContext,
  getAgentInvocationContextLabel,
} from "./context-manifest";

const noteTab: Tab = {
  id: "tab-note",
  kind: "note",
  targetId: "note-1",
  mode: "plate",
  title: "Note",
  pinned: false,
  preview: false,
  dirty: false,
  splitWith: null,
  splitSide: null,
  scrollY: 0,
};

describe("buildAgentContextPayload", () => {
  it("defaults note tabs to current document plus project context", async () => {
    const resolveNoteProjectId = vi.fn().mockResolvedValue("project-1");

    await expect(
      buildAgentContextPayload({
        activeTab: noteTab,
        workspaceId: "workspace-1",
        sourcePolicy: "auto_project",
        memoryPolicy: "auto",
        externalSearch: "off",
        resolveNoteProjectId,
      }),
    ).resolves.toEqual({
      manifest: {
        activeArtifact: { type: "note", id: "note-1" },
        actionApprovalMode: "require",
        externalSearch: "off",
        memoryPolicy: "auto",
        projectId: "project-1",
        sourcePolicy: "auto_project",
        workspaceId: "workspace-1",
      },
      chips: [
        { type: "page", id: "note-1" },
        { type: "project", id: "project-1" },
      ],
      strict: "strict",
    });
  });

  it("maps selected-material mode to current artifact only", async () => {
    await expect(
      buildAgentContextPayload({
        activeTab: { ...noteTab, kind: "project", targetId: "project-1" },
        workspaceId: "workspace-1",
        sourcePolicy: "current_only",
        memoryPolicy: "off",
        externalSearch: "allowed",
      }),
    ).resolves.toEqual({
      manifest: {
        activeArtifact: { type: "project", id: "project-1" },
        actionApprovalMode: "require",
        externalSearch: "allowed",
        memoryPolicy: "off",
        projectId: "project-1",
        sourcePolicy: "current_only",
        workspaceId: "workspace-1",
      },
      chips: [{ type: "project", id: "project-1" }],
      strict: "strict",
    });
  });

  it("keeps current-document mode bounded to the note itself", async () => {
    const resolveNoteProjectId = vi.fn().mockResolvedValue("project-1");

    await expect(
      buildAgentContextPayload({
        activeTab: noteTab,
        workspaceId: "workspace-1",
        sourcePolicy: "current_only",
        memoryPolicy: "off",
        externalSearch: "off",
        resolveNoteProjectId,
      }),
    ).resolves.toMatchObject({
      chips: [{ type: "page", id: "note-1" }],
      strict: "strict",
    });
  });

  it("uses the shell project fallback for project commands opened from the explorer", async () => {
    await expect(
      buildAgentContextPayload({
        activeTab: undefined,
        workspaceId: "workspace-1",
        sourcePolicy: "auto_project",
        memoryPolicy: "auto",
        externalSearch: "off",
        fallbackProjectId: "project-1",
      }),
    ).resolves.toMatchObject({
      manifest: {
        projectId: "project-1",
        sourcePolicy: "auto_project",
      },
      chips: [{ type: "project", id: "project-1" }],
      strict: "strict",
    });
  });

  it("adds dropped project tree references as explicit context", async () => {
    await expect(
      buildAgentContextPayload({
        activeTab: undefined,
        workspaceId: "workspace-1",
        sourcePolicy: "auto_project",
        memoryPolicy: "auto",
        externalSearch: "off",
        fallbackProjectId: "project-1",
        attachedReferences: [
          {
            id: "node-note",
            targetId: "note-1",
            kind: "note",
            label: "Source note",
            parentId: null,
          },
          {
            id: "node-file",
            targetId: "file-1",
            kind: "agent_file",
            label: "paper.pdf",
            parentId: null,
          },
        ],
      }),
    ).resolves.toEqual({
      manifest: {
        attachedArtifacts: [
          {
            id: "file-1",
            label: "paper.pdf",
            treeNodeId: "node-file",
            type: "agent_file",
          },
        ],
        actionApprovalMode: "require",
        externalSearch: "off",
        memoryPolicy: "auto",
        projectId: "project-1",
        sourcePolicy: "auto_project",
        workspaceId: "workspace-1",
      },
      chips: [
        { type: "project", id: "project-1" },
        { type: "page", id: "note-1", label: "Source note", manual: true },
      ],
      strict: "strict",
    });
  });

  it("defaults agent actions to ask-before-action approval", async () => {
    const context = await buildAgentContextPayload({
      activeTab: { ...noteTab, kind: "project", targetId: "project-1" },
      workspaceId: "workspace-1",
      sourcePolicy: "auto_project",
      memoryPolicy: "auto",
      externalSearch: "allowed",
    });

    expect(context.manifest.actionApprovalMode).toBe("require");
  });

  it("carries structured workflow intent through the chat scope", async () => {
    await expect(
      buildAgentContextPayload({
        activeTab: undefined,
        workspaceId: "workspace-1",
        sourcePolicy: "auto_project",
        memoryPolicy: "auto",
        externalSearch: "allowed",
        fallbackProjectId: "project-1",
        workflowIntent: {
          kind: "document_generation",
          toolId: "pdf_report",
          prompt: "PDF 보고서를 만들어줘",
          payload: { action: "generate_project_object", format: "pdf" },
        },
      }),
    ).resolves.toMatchObject({
      manifest: {
        projectId: "project-1",
      },
      workflowIntent: {
        kind: "document_generation",
        toolId: "pdf_report",
        payload: { action: "generate_project_object", format: "pdf" },
      },
    });
  });

  it("keeps pinned references while active tab focus is disabled", async () => {
    await expect(
      buildAgentContextPayload({
        activeTab: undefined,
        workspaceId: "workspace-1",
        sourcePolicy: "auto_project",
        memoryPolicy: "auto",
        externalSearch: "off",
        fallbackProjectId: "project-1",
        attachedReferences: [
          {
            id: "node-note",
            targetId: "note-1",
            kind: "note",
            label: "Pinned note",
            parentId: null,
          },
        ],
      }),
    ).resolves.toMatchObject({
      manifest: {
        projectId: "project-1",
        sourcePolicy: "auto_project",
      },
      chips: [
        { type: "project", id: "project-1" },
        { type: "page", id: "note-1", label: "Pinned note", manual: true },
      ],
    });
  });
});

describe("agent invocation context", () => {
  it("maps active note tabs and bounded selection into visible context", () => {
    const context = getAgentInvocationContext(noteTab, {
      selectionText: "  ".padEnd(1300, "가"),
    });

    expect(context).toEqual({
      kind: "note",
      noteId: "note-1",
      title: "Note",
      selectionText: "가".repeat(1200),
    });
    expect(getAgentInvocationContextLabel(context)).toEqual({
      labelKey: "context.selection",
      title: "Note",
      selectionCount: 1200,
    });
  });

  it("classifies source, canvas, agent file, and project tabs", () => {
    expect(
      getAgentInvocationContext({ ...noteTab, mode: "source" }),
    ).toMatchObject({ kind: "source", sourceId: "note-1" });
    expect(
      getAgentInvocationContext({ ...noteTab, mode: "canvas" }),
    ).toMatchObject({ kind: "canvas", canvasId: "note-1" });
    expect(
      getAgentInvocationContext({
        ...noteTab,
        kind: "agent_file",
        targetId: "file-1",
      }),
    ).toMatchObject({ kind: "agent_file", fileId: "file-1" });
    expect(
      getAgentInvocationContext({
        ...noteTab,
        kind: "project",
        targetId: "project-1",
      }),
    ).toMatchObject({ kind: "project", projectId: "project-1" });
  });
});
