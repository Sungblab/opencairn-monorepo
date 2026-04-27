import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// Load root .env so DATABASE_URL is set before importing the db client —
// mirrors the pattern in code-runs.test.ts / wiki-links-constraint.test.ts.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
config({ path: path.resolve(__dirname, "../../../.env") });

const {
  db,
  user,
  workspaces,
  projects,
  notes,
  conversations,
  conversationMessages,
  pinnedAnswers,
} = await import("../src");
const { eq } = await import("drizzle-orm");

describe("conversations / conversation_messages / pinned_answers (Plan 11A)", () => {
  let userId: string;
  let workspaceId: string;
  let projectId: string;
  let noteId: string;

  beforeAll(async () => {
    await db.transaction(async (tx) => {
      const [u] = await tx
        .insert(user)
        .values({
          id: crypto.randomUUID(),
          email: `convo-${crypto.randomUUID().slice(0, 8)}@example.com`,
          name: "convo-test",
          emailVerified: false,
        })
        .returning();
      userId = u.id;

      const [ws] = await tx
        .insert(workspaces)
        .values({
          name: "Convo WS",
          slug: `convo-${crypto.randomUUID().slice(0, 8)}`,
          ownerId: userId,
        })
        .returning();
      workspaceId = ws.id;

      const [p] = await tx
        .insert(projects)
        .values({ name: "Convo P", workspaceId, createdBy: userId })
        .returning();
      projectId = p.id;

      const [n] = await tx
        .insert(notes)
        .values({ title: "Convo Note", projectId, workspaceId })
        .returning();
      noteId = n.id;
    });
  });

  afterAll(async () => {
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await db.delete(user).where(eq(user.id, userId));
  });

  it("creates a conversation with scope columns and default rollups", async () => {
    const [row] = await db
      .insert(conversations)
      .values({
        workspaceId,
        ownerUserId: userId,
        title: "test convo",
        scopeType: "page",
        scopeId: noteId,
        attachedChips: [{ type: "page", id: noteId, manual: false }],
        memoryFlags: { l3_global: true, l3_workspace: true, l4: true, l2: false },
      })
      .returning();

    expect(row.id).toBeDefined();
    expect(row.ragMode).toBe("strict"); // schema default
    // numeric(12,4) → string with full scale (postgres pads trailing zeros).
    expect(row.totalCostKrw).toBe("0.0000");
    expect(row.totalTokensIn).toBe(0);
    expect(row.totalTokensOut).toBe(0);
    expect(row.attachedChips).toEqual([
      { type: "page", id: noteId, manual: false },
    ]);
    expect(row.memoryFlags).toEqual({
      l3_global: true,
      l3_workspace: true,
      l4: true,
      l2: false,
    });
  });

  it("inserts a message with citations and round-trips them through jsonb", async () => {
    const [convo] = await db
      .insert(conversations)
      .values({
        workspaceId,
        ownerUserId: userId,
        scopeType: "workspace",
        scopeId: workspaceId,
        memoryFlags: { l3_global: true, l3_workspace: true, l4: true, l2: false },
      })
      .returning();

    const citation = {
      source_type: "note" as const,
      source_id: noteId,
      snippet: "RoPE rotates pairs.",
    };
    const [msg] = await db
      .insert(conversationMessages)
      .values({
        conversationId: convo.id,
        role: "assistant",
        content: "answer",
        citations: [citation],
        tokensIn: 100,
        tokensOut: 50,
        costKrw: "0.5",
      })
      .returning();

    expect(msg.citations).toEqual([citation]);
    expect(msg.role).toBe("assistant");
    expect(msg.tokensIn).toBe(100);
    expect(msg.tokensOut).toBe(50);
    expect(msg.costKrw).toBe("0.5000");
  });

  it("cascades message delete when conversation is deleted", async () => {
    const [convo] = await db
      .insert(conversations)
      .values({
        workspaceId,
        ownerUserId: userId,
        scopeType: "workspace",
        scopeId: workspaceId,
        memoryFlags: { l3_global: true, l3_workspace: true, l4: true, l2: false },
      })
      .returning();
    await db.insert(conversationMessages).values({
      conversationId: convo.id,
      role: "user",
      content: "hi",
    });

    await db.delete(conversations).where(eq(conversations.id, convo.id));

    const remaining = await db
      .select()
      .from(conversationMessages)
      .where(eq(conversationMessages.conversationId, convo.id));
    expect(remaining).toHaveLength(0);
  });

  it("pins an answer to a note with a reason tag", async () => {
    const [convo] = await db
      .insert(conversations)
      .values({
        workspaceId,
        ownerUserId: userId,
        scopeType: "page",
        scopeId: noteId,
        memoryFlags: { l3_global: true, l3_workspace: true, l4: true, l2: false },
      })
      .returning();
    const [msg] = await db
      .insert(conversationMessages)
      .values({
        conversationId: convo.id,
        role: "assistant",
        content: "pinned answer",
      })
      .returning();

    const [pin] = await db
      .insert(pinnedAnswers)
      .values({
        messageId: msg.id,
        noteId,
        blockId: "block-1",
        pinnedBy: userId,
        reason: "no_permission_delta",
      })
      .returning();

    expect(pin.id).toBeDefined();
    expect(pin.reason).toBe("no_permission_delta");
  });

  it("rejects scope_type values outside the enum", async () => {
    let thrown: unknown;
    try {
      await db.insert(conversations).values({
        workspaceId,
        ownerUserId: userId,
        // @ts-expect-error — intentionally invalid enum literal
        scopeType: "garbage",
        scopeId: noteId,
        memoryFlags: { l3_global: true, l3_workspace: true, l4: true, l2: false },
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeDefined();
    const cause = (thrown as { cause?: { code?: string } }).cause;
    expect(cause?.code).toBe("22P02"); // invalid_text_representation for enum
  });
});
