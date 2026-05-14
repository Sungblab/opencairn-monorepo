import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createApp } from "../src/app.js";
import { and, db, eq, taskFeedback, user, workspaceMembers } from "@opencairn/db";
import {
  createUser,
  seedMultiRoleWorkspace,
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

function feedbackBody(projectId: string, targetId = "run-1") {
  return {
    projectId,
    targetType: "workflow_run",
    targetId,
    rating: "useful",
    reason: "helpful",
    followUpIntent: "none",
  };
}

describe("Task feedback", () => {
  let seed: SeedMultiRoleResult;

  beforeEach(async () => {
    seed = await seedMultiRoleWorkspace();
  });

  afterEach(async () => {
    await seed.cleanup();
  });

  it("upserts project-scoped feedback for an authorized project member", async () => {
    const first = await authedFetch("/api/task-feedback", {
      method: "POST",
      userId: seed.ownerUserId,
      body: JSON.stringify(feedbackBody(seed.projectId)),
    });
    expect(first.status).toBe(201);

    const second = await authedFetch("/api/task-feedback", {
      method: "POST",
      userId: seed.ownerUserId,
      body: JSON.stringify({
        ...feedbackBody(seed.projectId),
        rating: "not_useful",
        reason: "incorrect",
      }),
    });
    expect(second.status).toBe(201);

    const get = await authedFetch(
      `/api/task-feedback?projectId=${seed.projectId}&targetType=workflow_run&targetId=run-1`,
      { method: "GET", userId: seed.ownerUserId },
    );
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual({
      rating: "not_useful",
      reason: "incorrect",
      comment: null,
      followUpIntent: "none",
    });

    const rows = await db
      .select()
      .from(taskFeedback)
      .where(
        and(
          eq(taskFeedback.projectId, seed.projectId),
          eq(taskFeedback.targetType, "workflow_run"),
          eq(taskFeedback.targetId, "run-1"),
          eq(taskFeedback.userId, seed.ownerUserId),
        ),
      );
    expect(rows).toHaveLength(1);
  });

  it("returns null when an authorized project member has not left feedback", async () => {
    const get = await authedFetch(
      `/api/task-feedback?projectId=${seed.projectId}&targetType=workflow_run&targetId=missing-run`,
      { method: "GET", userId: seed.ownerUserId },
    );
    expect(get.status).toBe(200);
    expect(await get.json()).toBeNull();
  });

  it("hides a project from users who are not workspace members", async () => {
    const outsider = await createUser();

    const post = await authedFetch("/api/task-feedback", {
      method: "POST",
      userId: outsider.id,
      body: JSON.stringify(feedbackBody(seed.projectId)),
    });
    expect(post.status).toBe(404);

    const get = await authedFetch(
      `/api/task-feedback?projectId=${seed.projectId}&targetType=workflow_run&targetId=run-1`,
      { method: "GET", userId: outsider.id },
    );
    expect(get.status).toBe(404);

    await db.delete(user).where(eq(user.id, outsider.id));
  });

  it("returns 403 for workspace members who lack project access", async () => {
    const guest = await createUser();
    await db.insert(workspaceMembers).values({
      workspaceId: seed.workspaceId,
      userId: guest.id,
      role: "guest",
    });

    const post = await authedFetch("/api/task-feedback", {
      method: "POST",
      userId: guest.id,
      body: JSON.stringify(feedbackBody(seed.projectId)),
    });
    expect(post.status).toBe(403);

    const get = await authedFetch(
      `/api/task-feedback?projectId=${seed.projectId}&targetType=workflow_run&targetId=run-1`,
      { method: "GET", userId: guest.id },
    );
    expect(get.status).toBe(403);

    await db.delete(user).where(eq(user.id, guest.id));
  });

  it("returns 404, not 403, for unknown projects", async () => {
    const unknownProjectId = "00000000-0000-4000-8000-000000000000";
    const post = await authedFetch("/api/task-feedback", {
      method: "POST",
      userId: seed.ownerUserId,
      body: JSON.stringify(feedbackBody(unknownProjectId)),
    });
    expect(post.status).toBe(404);

    const get = await authedFetch(
      `/api/task-feedback?projectId=${unknownProjectId}&targetType=workflow_run&targetId=run-1`,
      { method: "GET", userId: seed.ownerUserId },
    );
    expect(get.status).toBe(404);
  });
});
