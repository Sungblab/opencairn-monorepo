import { describe, expect, it, vi } from "vitest";
import type { Tab } from "@/stores/tabs-store";
import { buildAgentScopePayload } from "./scope-payload";

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

describe("buildAgentScopePayload", () => {
  it("includes the selected note page and its parent project", async () => {
    const resolveNoteProjectId = vi.fn().mockResolvedValue("project-1");

    await expect(
      buildAgentScopePayload({
        selectedScopeIds: ["page", "project"],
        activeTab: noteTab,
        workspaceId: "workspace-1",
        strict: "strict",
        resolveNoteProjectId,
      }),
    ).resolves.toEqual({
      chips: [
        { type: "page", id: "note-1" },
        { type: "project", id: "project-1" },
      ],
      strict: "strict",
    });
    expect(resolveNoteProjectId).toHaveBeenCalledWith("note-1");
  });

  it("keeps project tabs synchronous", async () => {
    await expect(
      buildAgentScopePayload({
        selectedScopeIds: ["project", "workspace"],
        activeTab: { ...noteTab, kind: "project", targetId: "project-1" },
        workspaceId: "workspace-1",
        strict: "loose",
      }),
    ).resolves.toEqual({
      chips: [
        { type: "project", id: "project-1" },
        { type: "workspace", id: "workspace-1" },
      ],
      strict: "loose",
    });
  });
});
