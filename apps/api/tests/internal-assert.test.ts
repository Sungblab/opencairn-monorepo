import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "crypto";
import {
  db,
  user,
  workspaces,
  workspaceMembers,
  projects,
  notes,
  concepts,
  eq,
} from "@opencairn/db";
import {
  assertResourceWorkspace,
  assertManyResourceWorkspace,
  WorkspaceMismatchError,
} from "../src/lib/internal-assert.js";

// Two-workspace fixture: wsA and wsB each own a project, and each project
// owns a note + a concept. Gives us a clean "same-workspace passes,
// cross-workspace throws, deleted resource throws" matrix without pulling
// in the full seed helpers.
interface TwoWorkspaceFixture {
  userId: string;
  wsA: { workspaceId: string; projectId: string; noteId: string; conceptId: string };
  wsB: { workspaceId: string; projectId: string; noteId: string; conceptId: string };
  cleanup: () => Promise<void>;
}

async function seedTwoWorkspaces(): Promise<TwoWorkspaceFixture> {
  const userId = randomUUID();
  await db.insert(user).values({
    id: userId,
    email: `assert-${userId}@example.com`,
    name: "assert test",
    emailVerified: true,
  });

  async function makeWorkspace(label: string) {
    const workspaceId = randomUUID();
    // slug must be all lowercase (migration 0014 workspaces_slug_lower_check).
    const slug = `assert-${label.toLowerCase()}-${workspaceId.slice(0, 8)}`;
    await db.insert(workspaces).values({
      id: workspaceId,
      slug,
      name: label,
      ownerId: userId,
      planType: "free",
    });
    await db.insert(workspaceMembers).values({
      workspaceId,
      userId,
      role: "owner",
    });
    const projectId = randomUUID();
    await db.insert(projects).values({
      id: projectId,
      workspaceId,
      name: `${label}-project`,
      createdBy: userId,
    });
    const noteId = randomUUID();
    await db.insert(notes).values({
      id: noteId,
      projectId,
      workspaceId,
      title: `${label}-note`,
    });
    const conceptId = randomUUID();
    await db.insert(concepts).values({
      id: conceptId,
      projectId,
      name: `${label}-concept`,
      description: "",
    });
    return { workspaceId, projectId, noteId, conceptId };
  }

  const wsA = await makeWorkspace("A");
  const wsB = await makeWorkspace("B");

  const cleanup = async () => {
    await db.delete(concepts).where(eq(concepts.id, wsA.conceptId));
    await db.delete(concepts).where(eq(concepts.id, wsB.conceptId));
    await db.delete(notes).where(eq(notes.id, wsA.noteId));
    await db.delete(notes).where(eq(notes.id, wsB.noteId));
    await db.delete(projects).where(eq(projects.id, wsA.projectId));
    await db.delete(projects).where(eq(projects.id, wsB.projectId));
    await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, wsA.workspaceId));
    await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, wsB.workspaceId));
    await db.delete(workspaces).where(eq(workspaces.id, wsA.workspaceId));
    await db.delete(workspaces).where(eq(workspaces.id, wsB.workspaceId));
    await db.delete(user).where(eq(user.id, userId));
  };

  return { userId, wsA, wsB, cleanup };
}

describe("assertResourceWorkspace", () => {
  let fx: TwoWorkspaceFixture;

  beforeEach(async () => {
    fx = await seedTwoWorkspaces();
  });

  afterEach(async () => {
    await fx.cleanup();
  });

  it("project: same workspace passes", async () => {
    await expect(
      assertResourceWorkspace(db, fx.wsA.workspaceId, {
        type: "project",
        id: fx.wsA.projectId,
      }),
    ).resolves.toBeUndefined();
  });

  it("project: cross-workspace throws", async () => {
    await expect(
      assertResourceWorkspace(db, fx.wsB.workspaceId, {
        type: "project",
        id: fx.wsA.projectId,
      }),
    ).rejects.toBeInstanceOf(WorkspaceMismatchError);
  });

  it("project: non-existent id throws with actual=null", async () => {
    const bogus = randomUUID();
    await expect(
      assertResourceWorkspace(db, fx.wsA.workspaceId, {
        type: "project",
        id: bogus,
      }),
    ).rejects.toMatchObject({ name: "WorkspaceMismatchError", actual: null });
  });

  it("note: same workspace passes", async () => {
    await expect(
      assertResourceWorkspace(db, fx.wsA.workspaceId, {
        type: "note",
        id: fx.wsA.noteId,
      }),
    ).resolves.toBeUndefined();
  });

  it("note: soft-deleted note is treated as missing", async () => {
    await db
      .update(notes)
      .set({ deletedAt: new Date() })
      .where(eq(notes.id, fx.wsA.noteId));
    await expect(
      assertResourceWorkspace(db, fx.wsA.workspaceId, {
        type: "note",
        id: fx.wsA.noteId,
      }),
    ).rejects.toMatchObject({ actual: null });
  });

  it("concept: joins through project and passes when same workspace", async () => {
    await expect(
      assertResourceWorkspace(db, fx.wsA.workspaceId, {
        type: "concept",
        id: fx.wsA.conceptId,
      }),
    ).resolves.toBeUndefined();
  });

  it("concept: cross-workspace (concept in project B) throws", async () => {
    await expect(
      assertResourceWorkspace(db, fx.wsA.workspaceId, {
        type: "concept",
        id: fx.wsB.conceptId,
      }),
    ).rejects.toBeInstanceOf(WorkspaceMismatchError);
  });
});

describe("assertManyResourceWorkspace", () => {
  let fx: TwoWorkspaceFixture;

  beforeEach(async () => {
    fx = await seedTwoWorkspaces();
  });

  afterEach(async () => {
    await fx.cleanup();
  });

  it("empty list is a no-op", async () => {
    await expect(
      assertManyResourceWorkspace(db, fx.wsA.workspaceId, {
        type: "concept",
        ids: [],
      }),
    ).resolves.toBeUndefined();
  });

  it("all-same-workspace concepts pass", async () => {
    // Insert a second concept in wsA so we have 2 to check.
    const secondId = randomUUID();
    await db.insert(concepts).values({
      id: secondId,
      projectId: fx.wsA.projectId,
      name: "A-concept-2",
      description: "",
    });
    try {
      await expect(
        assertManyResourceWorkspace(db, fx.wsA.workspaceId, {
          type: "concept",
          ids: [fx.wsA.conceptId, secondId],
        }),
      ).resolves.toBeUndefined();
    } finally {
      await db.delete(concepts).where(eq(concepts.id, secondId));
    }
  });

  it("throws on the first cross-workspace id", async () => {
    await expect(
      assertManyResourceWorkspace(db, fx.wsA.workspaceId, {
        type: "concept",
        ids: [fx.wsA.conceptId, fx.wsB.conceptId],
      }),
    ).rejects.toMatchObject({
      name: "WorkspaceMismatchError",
      resource: { id: fx.wsB.conceptId },
    });
  });

  it("non-existent id throws with actual=null", async () => {
    const bogus = randomUUID();
    await expect(
      assertManyResourceWorkspace(db, fx.wsA.workspaceId, {
        type: "concept",
        ids: [fx.wsA.conceptId, bogus],
      }),
    ).rejects.toMatchObject({ actual: null });
  });

  it("duplicate ids in input are deduped (no false mismatch)", async () => {
    await expect(
      assertManyResourceWorkspace(db, fx.wsA.workspaceId, {
        type: "concept",
        ids: [fx.wsA.conceptId, fx.wsA.conceptId],
      }),
    ).resolves.toBeUndefined();
  });
});
