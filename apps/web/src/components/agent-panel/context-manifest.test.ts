import { describe, expect, it, vi } from "vitest";
import type { Tab } from "@/stores/tabs-store";

import { buildAgentContextPayload } from "./context-manifest";

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
