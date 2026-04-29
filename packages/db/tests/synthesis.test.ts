import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// Load root .env so DATABASE_URL is set before importing the db client.
// Mirrors `code-runs.test.ts` — the client constructs its postgres pool
// eagerly at module load.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
config({ path: path.resolve(__dirname, "../../../.env") });

const {
  db,
  workspaces,
  user,
  synthesisRuns,
  synthesisSources,
  synthesisDocuments,
} = await import("../src");
const { eq } = await import("drizzle-orm");

describe("synthesis schema", () => {
  let workspaceId: string;
  let userId: string;

  beforeAll(async () => {
    await db.transaction(async (tx) => {
      const [u] = await tx
        .insert(user)
        .values({
          id: crypto.randomUUID(),
          email: `syn-${crypto.randomUUID().slice(0, 8)}@example.com`,
          name: "syn-test",
          emailVerified: false,
        })
        .returning();
      userId = u.id;
      const [ws] = await tx
        .insert(workspaces)
        .values({
          name: "Syn Test",
          slug: `syn-${crypto.randomUUID().slice(0, 8)}`,
          ownerId: userId,
        })
        .returning();
      workspaceId = ws.id;
    });
  });

  afterAll(async () => {
    // Workspace cascade clears synthesis_runs / sources / documents.
    // User delete is restricted by workspace.ownerId, so workspace goes first.
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await db.delete(user).where(eq(user.id, userId));
  });

  it("inserts a run with default status='pending' and round-trips", async () => {
    const [run] = await db
      .insert(synthesisRuns)
      .values({
        workspaceId,
        userId,
        format: "latex",
        template: "korean_thesis",
        userPrompt: "thesis intro",
        autoSearch: false,
      })
      .returning();
    expect(run.status).toBe("pending");
    const [fetched] = await db
      .select()
      .from(synthesisRuns)
      .where(eq(synthesisRuns.id, run.id));
    expect(fetched.format).toBe("latex");
  });

  it("cascades source rows on run delete", async () => {
    const [run] = await db
      .insert(synthesisRuns)
      .values({
        workspaceId,
        userId,
        format: "md",
        template: "report",
        userPrompt: "x",
        autoSearch: false,
      })
      .returning();
    await db.insert(synthesisSources).values({
      runId: run.id,
      sourceType: "note",
      sourceId: crypto.randomUUID(),
      title: "n",
      tokenCount: 100,
      included: true,
    });
    await db.delete(synthesisRuns).where(eq(synthesisRuns.id, run.id));
    const remaining = await db
      .select()
      .from(synthesisSources)
      .where(eq(synthesisSources.runId, run.id));
    expect(remaining.length).toBe(0);
  });

  it("inserts a document row with format=zip", async () => {
    const [run] = await db
      .insert(synthesisRuns)
      .values({
        workspaceId,
        userId,
        format: "latex",
        template: "ieee",
        userPrompt: "x",
        autoSearch: false,
      })
      .returning();
    const [doc] = await db
      .insert(synthesisDocuments)
      .values({
        runId: run.id,
        format: "zip",
        s3Key: "synthesis/zip/abc.zip",
        bytes: 1024,
      })
      .returning();
    expect(doc.format).toBe("zip");
  });
});
