import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  db,
  notes,
  projects,
  workspaces,
  user,
  wikiLinks,
  eq,
} from "@opencairn/db";
import { syncWikiLinks } from "../src/wiki-link-sync.js";

describe("syncWikiLinks (integration)", () => {
  let workspaceId: string;
  let projectId: string;
  let userId: string;
  let source: string;
  let liveTarget: string;
  let deletedTarget: string;

  beforeAll(async () => {
    // Wrap setup in a transaction so a downstream insert failure does not
    // leak the user row (afterAll only runs on beforeAll success).
    await db.transaction(async (tx) => {
      const [u] = await tx
        .insert(user)
        .values({ id: crypto.randomUUID(), email: `wls-${crypto.randomUUID().slice(0, 8)}@example.com`, name: "wls", emailVerified: false })
        .returning();
      userId = u.id;
      const [ws] = await tx
        .insert(workspaces)
        .values({ name: "WLS", slug: `wls-${crypto.randomUUID().slice(0, 8)}`, ownerId: userId })
        .returning();
      workspaceId = ws.id;
      const [p] = await tx.insert(projects).values({ name: "P", workspaceId, createdBy: userId }).returning();
      projectId = p.id;
      const [s] = await tx.insert(notes).values({ title: "src", projectId, workspaceId }).returning();
      source = s.id;
      const [t1] = await tx.insert(notes).values({ title: "live", projectId, workspaceId }).returning();
      liveTarget = t1.id;
      const [t2] = await tx.insert(notes).values({ title: "gone", projectId, workspaceId, deletedAt: new Date() }).returning();
      deletedTarget = t2.id;
    });
  });

  afterAll(async () => {
    // workspace cascade clears projects + notes + wiki_links; user must be
    // deleted last (workspace.ownerId FK).
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await db.delete(user).where(eq(user.id, userId));
  });

  it("inserts rows for live targets only", async () => {
    await db.transaction(async (tx) => {
      await syncWikiLinks(
        tx,
        source,
        new Set([liveTarget, deletedTarget, "00000000-0000-0000-0000-000000000000"]),
        workspaceId,
      );
    });
    const rows = await db.select().from(wikiLinks).where(eq(wikiLinks.sourceNoteId, source));
    expect(rows.map((r) => r.targetNoteId)).toEqual([liveTarget]);
  });

  it("rebuilds — empty target set deletes all rows for the source", async () => {
    await db.transaction(async (tx) => {
      await syncWikiLinks(tx, source, new Set(), workspaceId);
    });
    const rows = await db.select().from(wikiLinks).where(eq(wikiLinks.sourceNoteId, source));
    expect(rows).toHaveLength(0);
  });

  it("drops self-references", async () => {
    await db.transaction(async (tx) => {
      await syncWikiLinks(tx, source, new Set([source, liveTarget]), workspaceId);
    });
    const rows = await db.select().from(wikiLinks).where(eq(wikiLinks.sourceNoteId, source));
    expect(rows.map((r) => r.targetNoteId)).toEqual([liveTarget]);
  });

  it("drops cross-workspace targets", async () => {
    // Create a foreign workspace + project + note
    const [u2] = await db.insert(user).values({ id: crypto.randomUUID(), email: `wls2-${crypto.randomUUID().slice(0, 8)}@example.com`, name: "wls2", emailVerified: false }).returning();
    const [ws2] = await db.insert(workspaces).values({ name: "WLS2", slug: `wls2-${crypto.randomUUID().slice(0, 8)}`, ownerId: u2.id }).returning();
    const [p2] = await db.insert(projects).values({ name: "P2", workspaceId: ws2.id, createdBy: u2.id }).returning();
    const [foreign] = await db.insert(notes).values({ title: "foreign", projectId: p2.id, workspaceId: ws2.id }).returning();

    try {
      await db.transaction(async (tx) => {
        await syncWikiLinks(tx, source, new Set([liveTarget, foreign.id]), workspaceId);
      });
      const rows = await db.select().from(wikiLinks).where(eq(wikiLinks.sourceNoteId, source));
      expect(rows.map((r) => r.targetNoteId)).toEqual([liveTarget]);
    } finally {
      await db.delete(workspaces).where(eq(workspaces.id, ws2.id));
      await db.delete(user).where(eq(user.id, u2.id));
    }
  });
});
