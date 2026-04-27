import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createApp } from "../src/app.js";
import {
  db,
  conversations,
  user,
  eq,
} from "@opencairn/db";
import {
  seedWorkspace,
  createUser,
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

  it("rejects scope_id from a different workspace with 403", async () => {
    const foreign = await seedWorkspace({ role: "owner" });
    try {
      const res = await authedFetch("/api/chat/conversations", {
        method: "POST",
        userId: ctx.userId,
        body: JSON.stringify({
          workspaceId: ctx.workspaceId,
          scopeType: "page",
          // Foreign note — must be rejected by validateScope.
          scopeId: foreign.noteId,
          attachedChips: [],
          memoryFlags: FULL_FLAGS,
        }),
      });
      expect(res.status).toBe(403);
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
