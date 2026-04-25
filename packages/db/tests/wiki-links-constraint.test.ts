import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
config({ path: path.resolve(__dirname, "../../../.env") });

const { db, notes, projects, workspaces, user, wikiLinks } = await import("../src");
const { eq } = await import("drizzle-orm");

describe("wiki_links table", () => {
  let workspaceId: string;
  let projectId: string;
  let userId: string;
  let n1: string;
  let n2: string;

  beforeAll(async () => {
    // All setup inserts run in one transaction so a failure on the workspace,
    // project, or notes insert does not leak the user row (no `afterAll`
    // would run if `beforeAll` throws).
    await db.transaction(async (tx) => {
      const [u] = await tx
        .insert(user)
        .values({ id: crypto.randomUUID(), email: `wl-${crypto.randomUUID().slice(0, 8)}@example.com`, name: "wl-test", emailVerified: false })
        .returning();
      userId = u.id;
      const [ws] = await tx
        .insert(workspaces)
        .values({ name: "WL Test", slug: `wl-${crypto.randomUUID().slice(0, 8)}`, ownerId: userId })
        .returning();
      workspaceId = ws.id;
      const [p] = await tx
        .insert(projects)
        .values({ name: "P", workspaceId, createdBy: userId })
        .returning();
      projectId = p.id;
      const [a] = await tx
        .insert(notes)
        .values({ title: "A", projectId, workspaceId })
        .returning();
      const [b] = await tx
        .insert(notes)
        .values({ title: "B", projectId, workspaceId })
        .returning();
      n1 = a.id;
      n2 = b.id;
    });
  });

  afterAll(async () => {
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await db.delete(user).where(eq(user.id, userId));
  });

  it("inserts a wiki_links row", async () => {
    const [row] = await db
      .insert(wikiLinks)
      .values({ sourceNoteId: n1, targetNoteId: n2, workspaceId })
      .returning();
    expect(row.sourceNoteId).toBe(n1);
    expect(row.targetNoteId).toBe(n2);
  });

  it("rejects duplicate (source, target) pairs", async () => {
    let thrown: unknown;
    try {
      await db.insert(wikiLinks).values({ sourceNoteId: n1, targetNoteId: n2, workspaceId });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeDefined();
    const cause = (thrown as { cause?: { constraint_name?: string; code?: string } }).cause;
    expect(cause?.constraint_name).toBe("wiki_links_source_target_unique");
    expect(cause?.code).toBe("23505"); // unique_violation
  });

  it("cascades on source note hard delete", async () => {
    const [c] = await db.insert(notes).values({ title: "C", projectId, workspaceId }).returning();
    await db.insert(wikiLinks).values({ sourceNoteId: c.id, targetNoteId: n2, workspaceId });
    await db.delete(notes).where(eq(notes.id, c.id));
    const after = await db.select().from(wikiLinks).where(eq(wikiLinks.sourceNoteId, c.id));
    expect(after).toHaveLength(0);
  });

  it("cascades on target note hard delete", async () => {
    const [d] = await db.insert(notes).values({ title: "D", projectId, workspaceId }).returning();
    await db.insert(wikiLinks).values({ sourceNoteId: n1, targetNoteId: d.id, workspaceId });
    await db.delete(notes).where(eq(notes.id, d.id));
    const after = await db.select().from(wikiLinks).where(eq(wikiLinks.targetNoteId, d.id));
    expect(after).toHaveLength(0);
  });
});
