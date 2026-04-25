import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createApp } from "../src/app.js";
import { db, chatThreads, user, eq } from "@opencairn/db";
import {
  seedWorkspace,
  seedMultiRoleWorkspace,
  createUser,
  type SeedResult,
  type SeedMultiRoleResult,
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

interface ThreadListItem {
  id: string;
  title: string;
  updated_at: string;
  created_at: string;
}

describe("Threads REST", () => {
  let ctx: SeedResult;

  beforeEach(async () => {
    ctx = await seedWorkspace({ role: "owner" });
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it("owner creates a thread and list returns it", async () => {
    const create = await authedFetch("/api/threads", {
      method: "POST",
      userId: ctx.userId,
      body: JSON.stringify({ workspace_id: ctx.workspaceId, title: "Research query" }),
    });
    expect(create.status).toBe(201);
    const created = (await create.json()) as { id: string; title: string };
    expect(created.title).toBe("Research query");

    const list = await authedFetch(
      `/api/threads?workspace_id=${ctx.workspaceId}`,
      { method: "GET", userId: ctx.userId },
    );
    expect(list.status).toBe(200);
    const body = (await list.json()) as { threads: ThreadListItem[] };
    expect(body.threads).toHaveLength(1);
    expect(body.threads[0].id).toBe(created.id);
    expect(body.threads[0].title).toBe("Research query");
  });

  it("missing title defaults to empty string", async () => {
    const create = await authedFetch("/api/threads", {
      method: "POST",
      userId: ctx.userId,
      body: JSON.stringify({ workspace_id: ctx.workspaceId }),
    });
    expect(create.status).toBe(201);
    const created = (await create.json()) as { id: string; title: string };
    expect(created.title).toBe("");
  });
});

describe("Threads REST — multi-user scoping", () => {
  let seed: SeedMultiRoleResult;

  beforeEach(async () => {
    seed = await seedMultiRoleWorkspace();
  });

  afterEach(async () => {
    await seed.cleanup();
  });

  it("two members in same workspace see only their own threads", async () => {
    await authedFetch("/api/threads", {
      method: "POST",
      userId: seed.ownerUserId,
      body: JSON.stringify({ workspace_id: seed.workspaceId, title: "owner's thread" }),
    });
    await authedFetch("/api/threads", {
      method: "POST",
      userId: seed.editorUserId,
      body: JSON.stringify({ workspace_id: seed.workspaceId, title: "editor's thread" }),
    });

    const ownerList = await authedFetch(
      `/api/threads?workspace_id=${seed.workspaceId}`,
      { method: "GET", userId: seed.ownerUserId },
    );
    const ownerBody = (await ownerList.json()) as { threads: ThreadListItem[] };
    expect(ownerBody.threads).toHaveLength(1);
    expect(ownerBody.threads[0].title).toBe("owner's thread");

    const editorList = await authedFetch(
      `/api/threads?workspace_id=${seed.workspaceId}`,
      { method: "GET", userId: seed.editorUserId },
    );
    const editorBody = (await editorList.json()) as { threads: ThreadListItem[] };
    expect(editorBody.threads).toHaveLength(1);
    expect(editorBody.threads[0].title).toBe("editor's thread");
  });

  it("PATCH on another user's thread returns 403", async () => {
    const create = await authedFetch("/api/threads", {
      method: "POST",
      userId: seed.ownerUserId,
      body: JSON.stringify({ workspace_id: seed.workspaceId, title: "owner's" }),
    });
    const { id } = (await create.json()) as { id: string };

    const res = await authedFetch(`/api/threads/${id}`, {
      method: "PATCH",
      userId: seed.editorUserId,
      body: JSON.stringify({ title: "hijack" }),
    });
    expect(res.status).toBe(403);
  });

  it("DELETE on another user's thread returns 403", async () => {
    const create = await authedFetch("/api/threads", {
      method: "POST",
      userId: seed.ownerUserId,
      body: JSON.stringify({ workspace_id: seed.workspaceId, title: "owner's" }),
    });
    const { id } = (await create.json()) as { id: string };

    const res = await authedFetch(`/api/threads/${id}`, {
      method: "DELETE",
      userId: seed.editorUserId,
    });
    expect(res.status).toBe(403);
  });
});

describe("Threads REST — non-member rejection", () => {
  let ctx: SeedResult;
  let outsiderId: string;

  beforeEach(async () => {
    ctx = await seedWorkspace({ role: "owner" });
    const outsider = await createUser();
    outsiderId = outsider.id;
  });

  afterEach(async () => {
    await ctx.cleanup();
    // outsider has no workspace membership and no FK dependents — direct delete.
    await db.delete(user).where(eq(user.id, outsiderId));
  });

  it("non-member of workspace gets 403 on POST", async () => {
    const res = await authedFetch("/api/threads", {
      method: "POST",
      userId: outsiderId,
      body: JSON.stringify({ workspace_id: ctx.workspaceId, title: "intrusion" }),
    });
    expect(res.status).toBe(403);
  });

  it("non-member gets 403 on GET list", async () => {
    const res = await authedFetch(
      `/api/threads?workspace_id=${ctx.workspaceId}`,
      { method: "GET", userId: outsiderId },
    );
    expect(res.status).toBe(403);
  });
});

describe("Threads REST — mutations", () => {
  let ctx: SeedResult;

  beforeEach(async () => {
    ctx = await seedWorkspace({ role: "owner" });
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it("PATCH title updates the row (verified via list)", async () => {
    const create = await authedFetch("/api/threads", {
      method: "POST",
      userId: ctx.userId,
      body: JSON.stringify({ workspace_id: ctx.workspaceId, title: "old" }),
    });
    const { id } = (await create.json()) as { id: string };

    const patch = await authedFetch(`/api/threads/${id}`, {
      method: "PATCH",
      userId: ctx.userId,
      body: JSON.stringify({ title: "new" }),
    });
    expect(patch.status).toBe(200);
    expect(await patch.json()).toEqual({ ok: true });

    const list = await authedFetch(
      `/api/threads?workspace_id=${ctx.workspaceId}`,
      { method: "GET", userId: ctx.userId },
    );
    const body = (await list.json()) as { threads: ThreadListItem[] };
    expect(body.threads[0].title).toBe("new");
  });

  it("DELETE soft-archives (excluded from subsequent list)", async () => {
    const create = await authedFetch("/api/threads", {
      method: "POST",
      userId: ctx.userId,
      body: JSON.stringify({ workspace_id: ctx.workspaceId, title: "x" }),
    });
    const { id } = (await create.json()) as { id: string };

    const del = await authedFetch(`/api/threads/${id}`, {
      method: "DELETE",
      userId: ctx.userId,
    });
    expect(del.status).toBe(200);

    const list = await authedFetch(
      `/api/threads?workspace_id=${ctx.workspaceId}`,
      { method: "GET", userId: ctx.userId },
    );
    const body = (await list.json()) as { threads: ThreadListItem[] };
    expect(body.threads).toHaveLength(0);

    // Row still exists in DB with archivedAt set.
    const [row] = await db.select().from(chatThreads).where(eq(chatThreads.id, id));
    expect(row).toBeDefined();
    expect(row!.archivedAt).not.toBeNull();
  });

  it("PATCH archived=true also soft-archives", async () => {
    const create = await authedFetch("/api/threads", {
      method: "POST",
      userId: ctx.userId,
      body: JSON.stringify({ workspace_id: ctx.workspaceId, title: "x" }),
    });
    const { id } = (await create.json()) as { id: string };

    const patch = await authedFetch(`/api/threads/${id}`, {
      method: "PATCH",
      userId: ctx.userId,
      body: JSON.stringify({ archived: true }),
    });
    expect(patch.status).toBe(200);

    const list = await authedFetch(
      `/api/threads?workspace_id=${ctx.workspaceId}`,
      { method: "GET", userId: ctx.userId },
    );
    const body = (await list.json()) as { threads: ThreadListItem[] };
    expect(body.threads).toHaveLength(0);
  });

  it("malformed UUID in PATCH returns 400", async () => {
    const res = await authedFetch("/api/threads/not-a-uuid", {
      method: "PATCH",
      userId: ctx.userId,
      body: JSON.stringify({ title: "x" }),
    });
    expect(res.status).toBe(400);
  });

  it("malformed UUID in DELETE returns 400", async () => {
    const res = await authedFetch("/api/threads/not-a-uuid", {
      method: "DELETE",
      userId: ctx.userId,
    });
    expect(res.status).toBe(400);
  });

  it("PATCH on non-existent (well-formed) UUID returns 404", async () => {
    const res = await authedFetch(
      "/api/threads/00000000-0000-4000-8000-000000000000",
      {
        method: "PATCH",
        userId: ctx.userId,
        body: JSON.stringify({ title: "x" }),
      },
    );
    expect(res.status).toBe(404);
  });

  it("PATCH archived=false restores a previously archived thread", async () => {
    const create = await authedFetch("/api/threads", {
      method: "POST",
      userId: ctx.userId,
      body: JSON.stringify({ workspace_id: ctx.workspaceId, title: "restore-me" }),
    });
    const { id } = (await create.json()) as { id: string };

    // Archive first.
    const archive = await authedFetch(`/api/threads/${id}`, {
      method: "PATCH",
      userId: ctx.userId,
      body: JSON.stringify({ archived: true }),
    });
    expect(archive.status).toBe(200);

    // Confirm hidden from list.
    const hiddenList = await authedFetch(
      `/api/threads?workspace_id=${ctx.workspaceId}`,
      { method: "GET", userId: ctx.userId },
    );
    expect(((await hiddenList.json()) as { threads: ThreadListItem[] }).threads).toHaveLength(0);

    // Restore.
    const restore = await authedFetch(`/api/threads/${id}`, {
      method: "PATCH",
      userId: ctx.userId,
      body: JSON.stringify({ archived: false }),
    });
    expect(restore.status).toBe(200);

    // Reappears in list.
    const list = await authedFetch(
      `/api/threads?workspace_id=${ctx.workspaceId}`,
      { method: "GET", userId: ctx.userId },
    );
    const body = (await list.json()) as { threads: ThreadListItem[] };
    expect(body.threads).toHaveLength(1);
    expect(body.threads[0].id).toBe(id);

    // archivedAt is null again at the DB level.
    const [row] = await db.select().from(chatThreads).where(eq(chatThreads.id, id));
    expect(row!.archivedAt).toBeNull();
  });

  it("empty PATCH body does NOT bump updated_at", async () => {
    const create = await authedFetch("/api/threads", {
      method: "POST",
      userId: ctx.userId,
      body: JSON.stringify({ workspace_id: ctx.workspaceId, title: "stable" }),
    });
    const { id } = (await create.json()) as { id: string };

    const [before] = await db
      .select({ updatedAt: chatThreads.updatedAt })
      .from(chatThreads)
      .where(eq(chatThreads.id, id));

    const patch = await authedFetch(`/api/threads/${id}`, {
      method: "PATCH",
      userId: ctx.userId,
      body: JSON.stringify({}),
    });
    expect(patch.status).toBe(200);

    const [after] = await db
      .select({ updatedAt: chatThreads.updatedAt })
      .from(chatThreads)
      .where(eq(chatThreads.id, id));
    expect(after!.updatedAt.toISOString()).toBe(before!.updatedAt.toISOString());
  });

  it("PATCH archived=true does NOT bump updated_at (metadata-only)", async () => {
    const create = await authedFetch("/api/threads", {
      method: "POST",
      userId: ctx.userId,
      body: JSON.stringify({ workspace_id: ctx.workspaceId, title: "meta" }),
    });
    const { id } = (await create.json()) as { id: string };

    const [before] = await db
      .select({ updatedAt: chatThreads.updatedAt })
      .from(chatThreads)
      .where(eq(chatThreads.id, id));

    const patch = await authedFetch(`/api/threads/${id}`, {
      method: "PATCH",
      userId: ctx.userId,
      body: JSON.stringify({ archived: true }),
    });
    expect(patch.status).toBe(200);

    const [after] = await db
      .select({ updatedAt: chatThreads.updatedAt, archivedAt: chatThreads.archivedAt })
      .from(chatThreads)
      .where(eq(chatThreads.id, id));
    expect(after!.updatedAt.toISOString()).toBe(before!.updatedAt.toISOString());
    expect(after!.archivedAt).not.toBeNull();
  });

  it("PATCH with whitespace-only title returns 400", async () => {
    const create = await authedFetch("/api/threads", {
      method: "POST",
      userId: ctx.userId,
      body: JSON.stringify({ workspace_id: ctx.workspaceId, title: "ok" }),
    });
    const { id } = (await create.json()) as { id: string };

    const res = await authedFetch(`/api/threads/${id}`, {
      method: "PATCH",
      userId: ctx.userId,
      body: JSON.stringify({ title: "   " }),
    });
    expect(res.status).toBe(400);
  });
});
