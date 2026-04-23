import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/app.js";
import { db, folders } from "@opencairn/db";
import { seedWorkspace, type SeedResult } from "./helpers/seed.js";
import { signSessionCookie } from "./helpers/session.js";
import { labelFromId } from "../src/lib/tree-queries.js";
import {
  subscribeTreeEvents,
  type TreeEvent,
} from "../src/lib/tree-events.js";

const app = createApp();

async function authedPatch(
  id: string,
  body: unknown,
  userId: string,
): Promise<Response> {
  const cookie = await signSessionCookie(userId);
  return app.request(`/api/folders/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
}

async function insertFolder(opts: {
  projectId: string;
  parentId: string | null;
  name: string;
  parentPath?: string;
  position?: number;
}): Promise<{ id: string; path: string }> {
  const id = randomUUID();
  const path = opts.parentPath
    ? `${opts.parentPath}.${labelFromId(id)}`
    : labelFromId(id);
  await db.insert(folders).values({
    id,
    projectId: opts.projectId,
    parentId: opts.parentId,
    name: opts.name,
    position: opts.position ?? 0,
    path,
  });
  return { id, path };
}

describe("PATCH /api/folders/:id — tree event emissions", () => {
  let seed: SeedResult;

  beforeEach(async () => {
    seed = await seedWorkspace({ role: "owner" });
  });

  afterEach(async () => {
    await seed.cleanup();
  });

  it("emits tree.folder_reordered when only position changes (same parent)", async () => {
    const folder = await insertFolder({
      projectId: seed.projectId,
      parentId: null,
      name: "F",
      position: 0,
    });

    const events: TreeEvent[] = [];
    const unsubscribe = subscribeTreeEvents(seed.projectId, (e) =>
      events.push(e),
    );

    try {
      const res = await authedPatch(
        folder.id,
        { position: 5 },
        seed.userId,
      );
      expect(res.status).toBe(200);
    } finally {
      unsubscribe();
    }

    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain("tree.folder_reordered");
    // Must NOT emit folder_moved — parent didn't change.
    expect(kinds).not.toContain("tree.folder_moved");
  });

  it("stays silent when position is resent with the existing value (no-op)", async () => {
    const folder = await insertFolder({
      projectId: seed.projectId,
      parentId: null,
      name: "F",
      position: 3,
    });

    const events: TreeEvent[] = [];
    const unsubscribe = subscribeTreeEvents(seed.projectId, (e) =>
      events.push(e),
    );

    try {
      // Client retries a move with the same position — must not broadcast
      // an SSE event to every connected sidebar for a write that changed
      // nothing.
      const res = await authedPatch(
        folder.id,
        { position: 3 },
        seed.userId,
      );
      expect(res.status).toBe(200);
    } finally {
      unsubscribe();
    }

    const kinds = events.map((e) => e.kind);
    expect(kinds).not.toContain("tree.folder_reordered");
    expect(kinds).not.toContain("tree.folder_moved");
  });

  it("does not emit tree.folder_reordered when position is absent", async () => {
    const folder = await insertFolder({
      projectId: seed.projectId,
      parentId: null,
      name: "F",
    });

    const events: TreeEvent[] = [];
    const unsubscribe = subscribeTreeEvents(seed.projectId, (e) =>
      events.push(e),
    );

    try {
      const res = await authedPatch(
        folder.id,
        { name: "renamed only" },
        seed.userId,
      );
      expect(res.status).toBe(200);
    } finally {
      unsubscribe();
    }

    const kinds = events.map((e) => e.kind);
    expect(kinds).not.toContain("tree.folder_reordered");
    expect(kinds).toContain("tree.folder_renamed");
  });

  it("prefers tree.folder_moved over reordered when parent also changes", async () => {
    const oldParent = await insertFolder({
      projectId: seed.projectId,
      parentId: null,
      name: "Old",
    });
    const newParent = await insertFolder({
      projectId: seed.projectId,
      parentId: null,
      name: "New",
    });
    const child = await insertFolder({
      projectId: seed.projectId,
      parentId: oldParent.id,
      name: "Child",
      parentPath: oldParent.path,
    });

    const events: TreeEvent[] = [];
    const unsubscribe = subscribeTreeEvents(seed.projectId, (e) =>
      events.push(e),
    );

    try {
      const res = await authedPatch(
        child.id,
        { parentId: newParent.id, position: 7 },
        seed.userId,
      );
      expect(res.status).toBe(200);
    } finally {
      unsubscribe();
    }

    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain("tree.folder_moved");
    // Re-emission of reordered would be redundant — folder_moved already
    // triggers a full project-tree invalidate on the client.
    expect(kinds).not.toContain("tree.folder_reordered");
  });
});
