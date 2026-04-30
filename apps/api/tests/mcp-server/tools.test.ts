import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { db, eq, notes } from "@opencairn/db";
import { getMcpNote, listMcpProjects, searchMcpNotes } from "../../src/lib/mcp-server/search";
import { seedWorkspace, type SeedResult } from "../helpers/seed";

describe("MCP read-only tools", () => {
  let seed: SeedResult;

  beforeEach(async () => {
    seed = await seedWorkspace({ role: "admin" });
    await db
      .update(notes)
      .set({
        title: "Hybrid search note",
        contentText: "OpenCairn exposes read only MCP search over workspace notes",
      })
      .where(eq(notes.id, seed.noteId));
  });

  afterEach(async () => {
    await seed.cleanup();
  });

  it("lists projects and fetches notes inside the token workspace", async () => {
    const projects = await listMcpProjects({ workspaceId: seed.workspaceId });
    expect(projects.projects.map((p) => p.projectId)).toContain(seed.projectId);

    const note = await getMcpNote({ workspaceId: seed.workspaceId, noteId: seed.noteId });
    expect(note?.noteId).toBe(seed.noteId);
  });

  it("returns empty search hits for an out-of-workspace project filter", async () => {
    const other = await seedWorkspace({ role: "admin" });
    try {
      const result = await searchMcpNotes({
        workspaceId: seed.workspaceId,
        query: "OpenCairn",
        projectId: other.projectId,
      });
      expect(result.hits).toEqual([]);
    } finally {
      await other.cleanup();
    }
  });
});
