import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// Load root .env so DATABASE_URL is set before importing the db client.
// Mirrors `wiki-links-constraint.test.ts` — the client constructs its
// postgres pool eagerly at module load.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
config({ path: path.resolve(__dirname, "../../../.env") });

const { db, notes, projects, workspaces, user, codeRuns, codeTurns, canvasOutputs } =
  await import("../src");
const { eq } = await import("drizzle-orm");

describe("code_runs / code_turns / canvas_outputs", () => {
  let workspaceId: string;
  let projectId: string;
  let userId: string;
  let canvasNoteId: string;

  beforeAll(async () => {
    // All setup inserts run in one transaction so a failure on the workspace,
    // project, or notes insert does not leak the user row.
    await db.transaction(async (tx) => {
      const [u] = await tx
        .insert(user)
        .values({
          id: crypto.randomUUID(),
          email: `cr-${crypto.randomUUID().slice(0, 8)}@example.com`,
          name: "cr-test",
          emailVerified: false,
        })
        .returning();
      userId = u.id;
      const [ws] = await tx
        .insert(workspaces)
        .values({
          name: "CR Test",
          slug: `cr-${crypto.randomUUID().slice(0, 8)}`,
          ownerId: userId,
        })
        .returning();
      workspaceId = ws.id;
      const [p] = await tx
        .insert(projects)
        .values({ name: "P", workspaceId, createdBy: userId })
        .returning();
      projectId = p.id;
      // Canvas-typed note: sourceType='canvas' requires canvasLanguage NOT NULL
      // (notes_canvas_language_check from migration 0022).
      const [n] = await tx
        .insert(notes)
        .values({
          title: "Canvas Note",
          projectId,
          workspaceId,
          sourceType: "canvas",
          canvasLanguage: "python",
        })
        .returning();
      canvasNoteId = n.id;
    });
  });

  afterAll(async () => {
    // Workspace cascade clears projects + notes + code_runs + code_turns +
    // canvas_outputs (FK chain). User delete is restricted by workspace.ownerId,
    // so the workspace must go first.
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await db.delete(user).where(eq(user.id, userId));
  });

  it("round-trips a code_run + code_turn + canvas_output", async () => {
    const [run] = await db
      .insert(codeRuns)
      .values({
        noteId: canvasNoteId,
        workspaceId,
        userId,
        prompt: "draw a sine wave",
        language: "python",
        workflowId: `wf-${crypto.randomUUID()}`,
      })
      .returning();
    expect(run.status).toBe("pending");

    const [turn] = await db
      .insert(codeTurns)
      .values({
        runId: run.id,
        seq: 0,
        kind: "plan",
        source: "import matplotlib",
      })
      .returning();
    expect(turn.seq).toBe(0);

    const [out] = await db
      .insert(canvasOutputs)
      .values({
        noteId: canvasNoteId,
        runId: run.id,
        contentHash: `sha256-${crypto.randomUUID()}`,
        mimeType: "image/png",
        s3Key: `canvas/${run.id}/0.png`,
        bytes: 1234,
      })
      .returning();
    expect(out.id).toBeDefined();
  });

  it("rejects duplicate (run_id, seq) on code_turns", async () => {
    const [run] = await db
      .insert(codeRuns)
      .values({
        noteId: canvasNoteId,
        workspaceId,
        userId,
        prompt: "dup turn",
        language: "python",
        workflowId: `wf-${crypto.randomUUID()}`,
      })
      .returning();
    await db.insert(codeTurns).values({
      runId: run.id,
      seq: 0,
      kind: "plan",
      source: "x = 1",
    });

    let thrown: unknown;
    try {
      await db.insert(codeTurns).values({
        runId: run.id,
        seq: 0,
        kind: "plan",
        source: "x = 2",
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeDefined();
    const cause = (thrown as { cause?: { constraint_name?: string; code?: string } }).cause;
    expect(cause?.constraint_name).toBe("code_turns_run_seq_unique");
    expect(cause?.code).toBe("23505"); // unique_violation
  });

  it("rejects duplicate (note_id, content_hash) on canvas_outputs", async () => {
    const hash = `sha256-${crypto.randomUUID()}`;
    await db.insert(canvasOutputs).values({
      noteId: canvasNoteId,
      contentHash: hash,
      mimeType: "image/png",
      s3Key: `canvas/dup/a.png`,
      bytes: 1,
    });

    let thrown: unknown;
    try {
      await db.insert(canvasOutputs).values({
        noteId: canvasNoteId,
        contentHash: hash,
        mimeType: "image/png",
        s3Key: `canvas/dup/b.png`,
        bytes: 2,
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeDefined();
    const cause = (thrown as { cause?: { constraint_name?: string; code?: string } }).cause;
    expect(cause?.constraint_name).toBe("canvas_outputs_note_hash_unique");
    expect(cause?.code).toBe("23505"); // unique_violation
  });
});
