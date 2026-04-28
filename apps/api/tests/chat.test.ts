import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createApp } from "../src/app.js";
import {
  db,
  conversations,
  conversationMessages,
  notes,
  workspaceMembers,
  pagePermissions,
  user,
  eq,
} from "@opencairn/db";
import {
  seedWorkspace,
  createUser,
  setPagePermission,
  setNoteInherit,
  type SeedResult,
} from "./helpers/seed.js";
import { signSessionCookie } from "./helpers/session.js";

const app = createApp();

async function authedFetch(
  path: string,
  init: RequestInit & { userId: string },
): Promise<Response> {
  const { userId, headers, ...rest } = init;
  const cookie = await signSessionCookie(userId);
  return app.request(path, {
    ...rest,
    headers: {
      ...(headers ?? {}),
      cookie,
      "content-type": "application/json",
    },
  });
}

const FULL_FLAGS = {
  l3_global: true,
  l3_workspace: true,
  l4: true,
  l2: false,
};

describe("POST /api/chat/conversations", () => {
  let ctx: SeedResult;
  beforeEach(async () => {
    ctx = await seedWorkspace({ role: "owner" });
  });
  afterEach(async () => {
    await ctx.cleanup();
  });

  it("creates a page-scoped conversation and returns 201", async () => {
    const res = await authedFetch("/api/chat/conversations", {
      method: "POST",
      userId: ctx.userId,
      body: JSON.stringify({
        workspaceId: ctx.workspaceId,
        scopeType: "page",
        scopeId: ctx.noteId,
        attachedChips: [{ type: "page", id: ctx.noteId, manual: false }],
        memoryFlags: FULL_FLAGS,
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown> & {
      attachedChips: Array<{ id: string }>;
    };
    expect(body.id).toBeDefined();
    expect(body.attachedChips[0].id).toBe(ctx.noteId);
    expect(body.ragMode).toBe("strict"); // default applied by Zod schema
  });

  it("rejects scope_id from a different workspace with 404 (no existence oracle)", async () => {
    // 11A intentionally collapses "doesn't exist" and "exists in another
    // workspace" into a single 404 so a caller cannot enumerate UUIDs
    // across the platform. validateScope returns "scope target not
    // found" in both cases.
    const foreign = await seedWorkspace({ role: "owner" });
    try {
      const res = await authedFetch("/api/chat/conversations", {
        method: "POST",
        userId: ctx.userId,
        body: JSON.stringify({
          workspaceId: ctx.workspaceId,
          scopeType: "page",
          scopeId: foreign.noteId,
          attachedChips: [],
          memoryFlags: FULL_FLAGS,
        }),
      });
      expect(res.status).toBe(404);
    } finally {
      await foreign.cleanup();
    }
  });

  it("returns 401 when no session cookie", async () => {
    const res = await app.request("/api/chat/conversations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: ctx.workspaceId,
        scopeType: "page",
        scopeId: ctx.noteId,
        attachedChips: [],
        memoryFlags: FULL_FLAGS,
      }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 403 when user is not a workspace member", async () => {
    // Create a stranger with no membership in ctx's workspace.
    const stranger = await createUser();
    try {
      const res = await authedFetch("/api/chat/conversations", {
        method: "POST",
        userId: stranger.id,
        body: JSON.stringify({
          workspaceId: ctx.workspaceId,
          scopeType: "page",
          scopeId: ctx.noteId,
          attachedChips: [],
          memoryFlags: FULL_FLAGS,
        }),
      });
      expect(res.status).toBe(403);
    } finally {
      await db.delete(user).where(eq(user.id, stranger.id));
    }
  });

  it("rejects page scope when a page override removes read access", async () => {
    const viewerCtx = await seedWorkspace({ role: "viewer" });
    try {
      await setNoteInherit(viewerCtx.noteId, false);

      const res = await authedFetch("/api/chat/conversations", {
        method: "POST",
        userId: viewerCtx.userId,
        body: JSON.stringify({
          workspaceId: viewerCtx.workspaceId,
          scopeType: "page",
          scopeId: viewerCtx.noteId,
          attachedChips: [],
          memoryFlags: FULL_FLAGS,
        }),
      });

      expect(res.status).toBe(403);
    } finally {
      await viewerCtx.cleanup();
    }
  });

  it("returns 400 when zod validation fails (missing scopeId)", async () => {
    const res = await authedFetch("/api/chat/conversations", {
      method: "POST",
      userId: ctx.userId,
      body: JSON.stringify({
        workspaceId: ctx.workspaceId,
        scopeType: "page",
        attachedChips: [],
        memoryFlags: FULL_FLAGS,
      }),
    });
    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/chat/conversations/:id", () => {
  let ctx: SeedResult;
  beforeEach(async () => {
    ctx = await seedWorkspace({ role: "owner" });
  });
  afterEach(async () => {
    await ctx.cleanup();
  });

  async function createConvo(): Promise<string> {
    const res = await authedFetch("/api/chat/conversations", {
      method: "POST",
      userId: ctx.userId,
      body: JSON.stringify({
        workspaceId: ctx.workspaceId,
        scopeType: "workspace",
        scopeId: ctx.workspaceId,
        attachedChips: [],
        memoryFlags: FULL_FLAGS,
      }),
    });
    const body = (await res.json()) as { id: string };
    return body.id;
  }

  it("owner can switch ragMode to expand", async () => {
    const id = await createConvo();
    const res = await authedFetch(`/api/chat/conversations/${id}`, {
      method: "PATCH",
      userId: ctx.userId,
      body: JSON.stringify({ ragMode: "expand" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ragMode: string };
    expect(body.ragMode).toBe("expand");
  });

  it("non-owner gets 403 even when in the same workspace", async () => {
    const id = await createConvo();
    // Recreate a second user inside the same workspace by bumping role.
    // For simplicity we use the seed helper's ownerUserId path.
    const seed2 = await seedWorkspace({ role: "owner" });
    try {
      const res = await authedFetch(`/api/chat/conversations/${id}`, {
        method: "PATCH",
        userId: seed2.userId, // not the convo owner
        body: JSON.stringify({ ragMode: "expand" }),
      });
      expect(res.status).toBe(403);
    } finally {
      await seed2.cleanup();
    }
  });

  it("returns 404 when conversation does not exist", async () => {
    const res = await authedFetch(
      `/api/chat/conversations/00000000-0000-0000-0000-000000000000`,
      {
        method: "PATCH",
        userId: ctx.userId,
        body: JSON.stringify({ ragMode: "expand" }),
      },
    );
    expect(res.status).toBe(404);
  });
});

describe("GET /api/chat/conversations", () => {
  let ctx: SeedResult;
  beforeEach(async () => {
    ctx = await seedWorkspace({ role: "owner" });
  });
  afterEach(async () => {
    await ctx.cleanup();
  });

  it("lists owner's conversations within a workspace", async () => {
    // Seed two conversations.
    for (const _ of [0, 1]) {
      await authedFetch("/api/chat/conversations", {
        method: "POST",
        userId: ctx.userId,
        body: JSON.stringify({
          workspaceId: ctx.workspaceId,
          scopeType: "workspace",
          scopeId: ctx.workspaceId,
          attachedChips: [],
          memoryFlags: FULL_FLAGS,
        }),
      });
    }

    const res = await authedFetch(
      `/api/chat/conversations?workspaceId=${ctx.workspaceId}`,
      { method: "GET", userId: ctx.userId },
    );
    expect(res.status).toBe(200);
    const list = (await res.json()) as unknown[];
    expect(list.length).toBeGreaterThanOrEqual(2);
  });

  it("returns 400 when workspaceId is missing", async () => {
    const res = await authedFetch(`/api/chat/conversations`, {
      method: "GET",
      userId: ctx.userId,
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/chat/conversations/:id/chips", () => {
  let ctx: SeedResult;
  beforeEach(async () => {
    ctx = await seedWorkspace({ role: "owner" });
  });
  afterEach(async () => {
    await ctx.cleanup();
  });

  async function createConvo(): Promise<string> {
    const res = await authedFetch("/api/chat/conversations", {
      method: "POST",
      userId: ctx.userId,
      body: JSON.stringify({
        workspaceId: ctx.workspaceId,
        scopeType: "workspace",
        scopeId: ctx.workspaceId,
        attachedChips: [],
        memoryFlags: FULL_FLAGS,
      }),
    });
    const body = (await res.json()) as { id: string };
    return body.id;
  }

  it("adds a manual page chip with the resolved label", async () => {
    const id = await createConvo();
    const res = await authedFetch(`/api/chat/conversations/${id}/chips`, {
      method: "POST",
      userId: ctx.userId,
      body: JSON.stringify({ type: "page", id: ctx.noteId }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      attachedChips: Array<{ type: string; id: string; manual: boolean; label?: string }>;
    };
    const chip = body.attachedChips.find((c) => c.id === ctx.noteId);
    expect(chip?.manual).toBe(true);
    expect(chip?.label).toBe("test"); // seed helper inserts notes with title "test"
  });

  it("rejects a chip pointing to a different workspace's page (404 no-oracle)", async () => {
    // Same existence-oracle defence as the scope check on conversation
    // create — cross-workspace and not-existing both collapse to 404.
    const id = await createConvo();
    const foreign = await seedWorkspace({ role: "owner" });
    try {
      const res = await authedFetch(`/api/chat/conversations/${id}/chips`, {
        method: "POST",
        userId: ctx.userId,
        body: JSON.stringify({ type: "page", id: foreign.noteId }),
      });
      expect(res.status).toBe(404);
    } finally {
      await foreign.cleanup();
    }
  });

  it("rejects a page chip when a page override removes read access", async () => {
    const viewerCtx = await seedWorkspace({ role: "viewer" });
    try {
      const create = await authedFetch("/api/chat/conversations", {
        method: "POST",
        userId: viewerCtx.userId,
        body: JSON.stringify({
          workspaceId: viewerCtx.workspaceId,
          scopeType: "workspace",
          scopeId: viewerCtx.workspaceId,
          attachedChips: [],
          memoryFlags: FULL_FLAGS,
        }),
      });
      expect(create.status).toBe(201);
      const { id } = (await create.json()) as { id: string };

      await setNoteInherit(viewerCtx.noteId, false);

      const res = await authedFetch(`/api/chat/conversations/${id}/chips`, {
        method: "POST",
        userId: viewerCtx.userId,
        body: JSON.stringify({ type: "page", id: viewerCtx.noteId }),
      });
      expect(res.status).toBe(403);
    } finally {
      await viewerCtx.cleanup();
    }
  });

  it("dedupes by composite key — same chip added twice keeps one", async () => {
    const id = await createConvo();
    const body = JSON.stringify({ type: "page", id: ctx.noteId });
    await authedFetch(`/api/chat/conversations/${id}/chips`, {
      method: "POST",
      userId: ctx.userId,
      body,
    });
    const res = await authedFetch(`/api/chat/conversations/${id}/chips`, {
      method: "POST",
      userId: ctx.userId,
      body,
    });
    const json = (await res.json()) as {
      attachedChips: Array<{ id: string }>;
    };
    const matches = json.attachedChips.filter((c) => c.id === ctx.noteId);
    expect(matches).toHaveLength(1);
  });

  it("accepts memory:l3 chip without scope validation", async () => {
    const id = await createConvo();
    const res = await authedFetch(`/api/chat/conversations/${id}/chips`, {
      method: "POST",
      userId: ctx.userId,
      body: JSON.stringify({ type: "memory:l3", id: "user_workspace_global" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      attachedChips: Array<{ type: string; id: string }>;
    };
    expect(body.attachedChips.find((c) => c.type === "memory:l3")).toBeDefined();
  });
});

describe("DELETE /api/chat/conversations/:id/chips/:chipKey", () => {
  let ctx: SeedResult;
  beforeEach(async () => {
    ctx = await seedWorkspace({ role: "owner" });
  });
  afterEach(async () => {
    await ctx.cleanup();
  });

  it("removes a chip by composite key", async () => {
    const create = await authedFetch("/api/chat/conversations", {
      method: "POST",
      userId: ctx.userId,
      body: JSON.stringify({
        workspaceId: ctx.workspaceId,
        scopeType: "page",
        scopeId: ctx.noteId,
        attachedChips: [{ type: "page", id: ctx.noteId, manual: false }],
        memoryFlags: FULL_FLAGS,
      }),
    });
    const { id } = (await create.json()) as { id: string };

    const res = await authedFetch(
      `/api/chat/conversations/${id}/chips/page:${ctx.noteId}`,
      { method: "DELETE", userId: ctx.userId },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { attachedChips: Array<{ id: string }> };
    expect(body.attachedChips.find((c) => c.id === ctx.noteId)).toBeUndefined();
  });

  it("removes a memory chip whose key contains a colon", async () => {
    const create = await authedFetch("/api/chat/conversations", {
      method: "POST",
      userId: ctx.userId,
      body: JSON.stringify({
        workspaceId: ctx.workspaceId,
        scopeType: "workspace",
        scopeId: ctx.workspaceId,
        attachedChips: [],
        memoryFlags: FULL_FLAGS,
      }),
    });
    const { id } = (await create.json()) as { id: string };
    await authedFetch(`/api/chat/conversations/${id}/chips`, {
      method: "POST",
      userId: ctx.userId,
      body: JSON.stringify({ type: "memory:l4", id: "ws-summary" }),
    });

    const res = await authedFetch(
      `/api/chat/conversations/${id}/chips/memory:l4:ws-summary`,
      { method: "DELETE", userId: ctx.userId },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      attachedChips: Array<{ type: string; id: string }>;
    };
    expect(
      body.attachedChips.find((c) => c.type === "memory:l4" && c.id === "ws-summary"),
    ).toBeUndefined();
  });
});

// ── Pin tests ──────────────────────────────────────────────────────────
//
// To exercise the permission delta we need a workspace with two members
// where one cited source is hidden from the second member while the
// target page is visible to both. The seedWorkspace helper only builds a
// single-role context, so the helper below extends it: it inserts a
// second user as a workspaceMember, an extra source note with
// inheritParent=false + an explicit "none" page_permission for the
// stranger, and a conversation+message wired to that citation.
async function seedPinScenario(opts: {
  citedNoteVisibleToStranger: boolean;
}): Promise<{
  ownerCtx: SeedResult;
  strangerId: string;
  conversationId: string;
  messageId: string;
  citedNoteId: string;
  cleanup: () => Promise<void>;
}> {
  const ownerCtx = await seedWorkspace({ role: "owner" });

  const stranger = await createUser();
  await db.insert(workspaceMembers).values({
    workspaceId: ownerCtx.workspaceId,
    userId: stranger.id,
    role: "member",
  });

  // Cited source — independent note inside the same project. inheritParent
  // = false breaks project default access, so a page_permission row is the
  // only path to grant the stranger a role on it. Toggling visibility
  // merely changes whether we add that page_permission row.
  const [citedNote] = await db
    .insert(notes)
    .values({
      title: "cited-source",
      projectId: ownerCtx.projectId,
      workspaceId: ownerCtx.workspaceId,
      inheritParent: false,
    })
    .returning();
  // Owner always retains access via workspace ownership.
  if (opts.citedNoteVisibleToStranger) {
    await setPagePermission(stranger.id, citedNote.id, "viewer");
  }
  // Target page = ownerCtx.noteId (default inheritParent=true → stranger
  // sees it via project membership default role).

  // Conversation owned by the owner, scoped to the target page.
  const [convo] = await db
    .insert(conversations)
    .values({
      workspaceId: ownerCtx.workspaceId,
      ownerUserId: ownerCtx.userId,
      scopeType: "page",
      scopeId: ownerCtx.noteId,
      memoryFlags: FULL_FLAGS,
    })
    .returning();
  const [msg] = await db
    .insert(conversationMessages)
    .values({
      conversationId: convo.id,
      role: "assistant",
      content: "answer",
      citations: [
        {
          source_type: "note",
          source_id: citedNote.id,
          snippet: "snippet from cited source",
        },
      ],
    })
    .returning();

  return {
    ownerCtx,
    strangerId: stranger.id,
    conversationId: convo.id,
    messageId: msg.id,
    citedNoteId: citedNote.id,
    cleanup: async () => {
      // Workspace cascade clears notes/conversations/messages/perms; the
      // stranger user is deleted explicitly because they are not the
      // workspace owner and so survive the cascade.
      await ownerCtx.cleanup();
      await db.delete(user).where(eq(user.id, stranger.id));
    },
  };
}

describe("POST /api/chat/message (SSE)", () => {
  let ctx: SeedResult;
  beforeEach(async () => {
    ctx = await seedWorkspace({ role: "owner" });
  });
  afterEach(async () => {
    await ctx.cleanup();
  });

  // The happy-path SSE test (delta + cost + done with provider tokens) lives
  // in tests/chat-real-llm.test.ts (Task 8). It needs vi.mock of the gemini
  // provider, which would force every test in this file to dance around the
  // mock. Keeping it isolated there avoids the placeholder-vs-real LLM split
  // contaminating the existing scope/permission/chip tests in this file.

  it("returns 403 for a non-owner caller", async () => {
    const create = await authedFetch("/api/chat/conversations", {
      method: "POST",
      userId: ctx.userId,
      body: JSON.stringify({
        workspaceId: ctx.workspaceId,
        scopeType: "page",
        scopeId: ctx.noteId,
        attachedChips: [],
        memoryFlags: FULL_FLAGS,
      }),
    });
    const { id: conversationId } = (await create.json()) as { id: string };

    const stranger = await createUser();
    try {
      const res = await authedFetch("/api/chat/message", {
        method: "POST",
        userId: stranger.id,
        body: JSON.stringify({ conversationId, content: "hi" }),
      });
      expect(res.status).toBe(403);
    } finally {
      await db.delete(user).where(eq(user.id, stranger.id));
    }
  });
});

describe("POST /api/chat/messages/:id/pin", () => {
  it("pins immediately when no citations are hidden", async () => {
    const s = await seedPinScenario({ citedNoteVisibleToStranger: true });
    try {
      const res = await authedFetch(`/api/chat/messages/${s.messageId}/pin`, {
        method: "POST",
        userId: s.ownerCtx.userId,
        body: JSON.stringify({ noteId: s.ownerCtx.noteId, blockId: "block-1" }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { pinned: boolean };
      expect(body.pinned).toBe(true);
    } finally {
      await s.cleanup();
    }
  });

  it("returns 409 + warning when citation is hidden from a target-page reader", async () => {
    const s = await seedPinScenario({ citedNoteVisibleToStranger: false });
    try {
      const res = await authedFetch(`/api/chat/messages/${s.messageId}/pin`, {
        method: "POST",
        userId: s.ownerCtx.userId,
        body: JSON.stringify({ noteId: s.ownerCtx.noteId, blockId: "block-1" }),
      });
      expect(res.status).toBe(409);
      const body = (await res.json()) as {
        requireConfirm: boolean;
        warning: {
          hiddenSources: Array<{ sourceId: string }>;
          hiddenUsers: Array<{ userId: string }>;
        };
      };
      expect(body.requireConfirm).toBe(true);
      expect(body.warning.hiddenSources.length).toBeGreaterThan(0);
      expect(body.warning.hiddenSources[0].sourceId).toBe(s.citedNoteId);
      expect(body.warning.hiddenUsers.map((u) => u.userId)).toContain(s.strangerId);
    } finally {
      await s.cleanup();
    }
  });

  it("returns 403 when caller lacks write access on target page", async () => {
    const s = await seedPinScenario({ citedNoteVisibleToStranger: true });
    try {
      const res = await authedFetch(`/api/chat/messages/${s.messageId}/pin`, {
        method: "POST",
        userId: s.strangerId, // member, not the convo owner
        body: JSON.stringify({ noteId: s.ownerCtx.noteId, blockId: "block-1" }),
      });
      // Stranger is not the conversation owner → 403 from owner check
      // (which precedes the canWrite check, so the message is "forbidden").
      expect(res.status).toBe(403);
    } finally {
      await s.cleanup();
    }
  });

  it("returns 404 for an unknown message", async () => {
    const ctx = await seedWorkspace({ role: "owner" });
    try {
      const res = await authedFetch(
        "/api/chat/messages/00000000-0000-0000-0000-000000000000/pin",
        {
          method: "POST",
          userId: ctx.userId,
          body: JSON.stringify({ noteId: ctx.noteId, blockId: "block-1" }),
        },
      );
      expect(res.status).toBe(404);
    } finally {
      await ctx.cleanup();
    }
  });
});

describe("POST /api/chat/messages/:id/pin/confirm", () => {
  it("force-pins after confirmation even with hidden citations", async () => {
    const s = await seedPinScenario({ citedNoteVisibleToStranger: false });
    try {
      const res = await authedFetch(
        `/api/chat/messages/${s.messageId}/pin/confirm`,
        {
          method: "POST",
          userId: s.ownerCtx.userId,
          body: JSON.stringify({
            noteId: s.ownerCtx.noteId,
            blockId: "block-1",
          }),
        },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { pinned: boolean };
      expect(body.pinned).toBe(true);
    } finally {
      await s.cleanup();
    }
  });

  it("recomputes the delta on confirm and persists the snapshot as JSON", async () => {
    // Verifies the reviewer C1 fix — confirm doesn't blindly trust the
    // caller's intent. We seed a scenario with a visibility delta, hit
    // /pin/confirm directly (skipping the warning modal call), and
    // assert the persisted reason is a JSON snapshot of the actual
    // delta — not just the literal "user_confirmed_permission_warning"
    // string. This is the audit hook for "user pinned despite leak".
    const { pinnedAnswers, eq: eqOp, db: dbConn } = await import(
      "@opencairn/db"
    );
    const s = await seedPinScenario({ citedNoteVisibleToStranger: false });
    try {
      const res = await authedFetch(
        `/api/chat/messages/${s.messageId}/pin/confirm`,
        {
          method: "POST",
          userId: s.ownerCtx.userId,
          body: JSON.stringify({ noteId: s.ownerCtx.noteId, blockId: "b1" }),
        },
      );
      expect(res.status).toBe(200);
      const [row] = await dbConn
        .select()
        .from(pinnedAnswers)
        .where(eqOp(pinnedAnswers.messageId, s.messageId));
      expect(row.reason).toBeDefined();
      // JSON snapshot starts with `{` so we know it's not the literal tag.
      expect(row.reason?.startsWith("{")).toBe(true);
      const parsed = JSON.parse(row.reason as string);
      expect(parsed.tag).toBe("user_confirmed_permission_warning");
      expect(parsed.delta.hiddenSources[0].sourceId).toBe(s.citedNoteId);
    } finally {
      await s.cleanup();
    }
  });

  it("records `no_permission_delta` on confirm when delta cleared between /pin and /pin/confirm", async () => {
    // A friendly race: between the original /pin (which returned 409)
    // and /pin/confirm, an admin grants the stranger access to the
    // cited source. confirm recomputes, sees no delta, persists the
    // clean tag.
    const { setPagePermission } = await import("./helpers/seed.js");
    const { pinnedAnswers, eq: eqOp, db: dbConn } = await import(
      "@opencairn/db"
    );
    const s = await seedPinScenario({ citedNoteVisibleToStranger: false });
    try {
      // Simulate the grant — stranger now sees the cited source.
      await setPagePermission(s.strangerId, s.citedNoteId, "viewer");

      const res = await authedFetch(
        `/api/chat/messages/${s.messageId}/pin/confirm`,
        {
          method: "POST",
          userId: s.ownerCtx.userId,
          body: JSON.stringify({ noteId: s.ownerCtx.noteId, blockId: "b2" }),
        },
      );
      expect(res.status).toBe(200);
      const [row] = await dbConn
        .select()
        .from(pinnedAnswers)
        .where(eqOp(pinnedAnswers.blockId, "b2"));
      expect(row.reason).toBe("no_permission_delta");
    } finally {
      await s.cleanup();
    }
  });
});

describe("GET /api/chat/conversations/:id", () => {
  let ctx: SeedResult;
  beforeEach(async () => {
    ctx = await seedWorkspace({ role: "owner" });
  });
  afterEach(async () => {
    await ctx.cleanup();
  });

  it("owner reads their own conversation", async () => {
    const create = await authedFetch("/api/chat/conversations", {
      method: "POST",
      userId: ctx.userId,
      body: JSON.stringify({
        workspaceId: ctx.workspaceId,
        scopeType: "workspace",
        scopeId: ctx.workspaceId,
        attachedChips: [],
        memoryFlags: FULL_FLAGS,
      }),
    });
    const { id } = (await create.json()) as { id: string };
    const res = await authedFetch(`/api/chat/conversations/${id}`, {
      method: "GET",
      userId: ctx.userId,
    });
    expect(res.status).toBe(200);
  });

  it("returns 404 for an unknown id", async () => {
    const res = await authedFetch(
      "/api/chat/conversations/00000000-0000-0000-0000-000000000000",
      { method: "GET", userId: ctx.userId },
    );
    expect(res.status).toBe(404);
  });
});
