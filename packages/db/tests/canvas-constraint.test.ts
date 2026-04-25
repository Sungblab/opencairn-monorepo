import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// Load root .env so DATABASE_URL is set before importing the db client.
// vitest does not auto-load .env from the monorepo root, and the client
// constructs its postgres pool eagerly at module load.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
config({ path: path.resolve(__dirname, "../../../.env") });

const { db, notes, projects, workspaces, user } = await import("../src");
const { eq } = await import("drizzle-orm");

describe("notes_canvas_language_check constraint", () => {
  let workspaceId: string;
  let projectId: string;
  let userId: string;

  beforeAll(async () => {
    userId = `canvas-test-${Date.now()}`;
    await db.insert(user).values({
      id: userId,
      name: "Canvas Test",
      email: `canvas-test-${Date.now()}@example.com`,
    });
    const [ws] = await db
      .insert(workspaces)
      .values({
        name: "Canvas Test",
        slug: `canvas-test-${Date.now()}`,
        ownerId: userId,
      })
      .returning();
    workspaceId = ws.id;
    const [p] = await db
      .insert(projects)
      .values({ name: "Test", workspaceId, createdBy: userId })
      .returning();
    projectId = p.id;
  });

  afterAll(async () => {
    // Workspace cascade clears projects + notes; user delete is restricted
    // by workspace.ownerId, so order matters: workspace first.
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await db.delete(user).where(eq(user.id, userId));
  });

  it("rejects sourceType='canvas' with canvasLanguage=NULL", async () => {
    // postgres-js wraps the underlying PostgresError in a DrizzleQueryError
    // whose top-level message is `Failed query: ...`. The constraint name
    // lives on `cause.constraint_name` (postgres' SQLSTATE 23514 fields).
    let thrown: unknown;
    try {
      await db.insert(notes).values({
        title: "Bad Canvas",
        projectId,
        workspaceId,
        sourceType: "canvas",
        canvasLanguage: null,
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeDefined();
    const cause = (thrown as { cause?: { constraint_name?: string; code?: string } }).cause;
    expect(cause?.constraint_name).toBe("notes_canvas_language_check");
    expect(cause?.code).toBe("23514"); // check_violation
  });

  it("accepts sourceType='canvas' + canvasLanguage='python'", async () => {
    const [row] = await db
      .insert(notes)
      .values({
        title: "Good Canvas",
        projectId,
        workspaceId,
        sourceType: "canvas",
        canvasLanguage: "python",
        contentText: "print('hi')",
      })
      .returning();
    expect(row.canvasLanguage).toBe("python");
    await db.delete(notes).where(eq(notes.id, row.id));
  });

  it("accepts non-canvas notes with canvasLanguage=NULL (default)", async () => {
    const [row] = await db
      .insert(notes)
      .values({
        title: "Plain Note",
        projectId,
        workspaceId,
      })
      .returning();
    expect(row.canvasLanguage).toBeNull();
    await db.delete(notes).where(eq(notes.id, row.id));
  });
});
