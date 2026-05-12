import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import {
  agentActions,
  db,
  eq,
  projects,
  sql,
  user,
  workspaceMembers,
  workspaces,
} from "../src";

describe("agent_actions ledger table", () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await cleanup?.();
    cleanup = undefined;
  });

  it("stores server-scoped action rows and enforces request idempotency per project actor", async () => {
    const seeded = await seedProject();
    cleanup = seeded.cleanup;

    const requestId = randomUUID();
    const [inserted] = await db
      .insert(agentActions)
      .values({
        requestId,
        workspaceId: seeded.workspaceId,
        projectId: seeded.projectId,
        actorUserId: seeded.userId,
        kind: "workflow.placeholder",
        status: "completed",
        risk: "low",
        input: { label: "db-smoke" },
        preview: { summary: "placeholder" },
        result: { ok: true },
      })
      .returning();

    expect(inserted).toMatchObject({
      requestId,
      workspaceId: seeded.workspaceId,
      projectId: seeded.projectId,
      actorUserId: seeded.userId,
      kind: "workflow.placeholder",
      status: "completed",
      risk: "low",
      input: { label: "db-smoke" },
      result: { ok: true },
    });

    await expect(
      db.insert(agentActions).values({
        requestId,
        workspaceId: seeded.workspaceId,
        projectId: seeded.projectId,
        actorUserId: seeded.userId,
        kind: "workflow.placeholder",
        status: "completed",
        risk: "low",
      }),
    ).rejects.toThrow();
  });

  it("rejects action kinds outside the database enum", async () => {
    const seeded = await seedProject();
    cleanup = seeded.cleanup;

    await expect(
      db.execute(sql`
        insert into agent_actions (
          request_id,
          workspace_id,
          project_id,
          actor_user_id,
          kind,
          status,
          risk
        )
        values (
          ${randomUUID()}::uuid,
          ${seeded.workspaceId}::uuid,
          ${seeded.projectId}::uuid,
          ${seeded.userId},
          'unknown.kind',
          'completed',
          'low'
        )
      `),
    ).rejects.toThrow();
  });

  it("stores interaction.choice draft actions", async () => {
    const seeded = await seedProject();
    cleanup = seeded.cleanup;

    const [inserted] = await db
      .insert(agentActions)
      .values({
        requestId: randomUUID(),
        workspaceId: seeded.workspaceId,
        projectId: seeded.projectId,
        actorUserId: seeded.userId,
        kind: "interaction.choice",
        status: "draft",
        risk: "low",
        input: {
          cardId: "format",
          prompt: "어떤 형태로 만들까요?",
          options: [
            {
              id: "summary",
              label: "요약 노트",
              value: "요약 노트로 만들어줘",
            },
          ],
        },
      })
      .returning();

    expect(inserted).toMatchObject({
      kind: "interaction.choice",
      status: "draft",
      risk: "low",
    });
  });
});

async function seedProject() {
  const userId = randomUUID();
  await db.insert(user).values({
    id: userId,
    email: `${userId}@example.com`,
    name: "Agent Action Tester",
    emailVerified: false,
  });

  const [workspace] = await db
    .insert(workspaces)
    .values({
      name: "Agent Action Workspace",
      slug: `agent-actions-${randomUUID().slice(0, 8)}`,
      ownerId: userId,
    })
    .returning();

  await db.insert(workspaceMembers).values({
    workspaceId: workspace!.id,
    userId,
    role: "owner",
  });

  const [project] = await db
    .insert(projects)
    .values({
      name: "Agent Action Project",
      workspaceId: workspace!.id,
      createdBy: userId,
    })
    .returning();

  return {
    userId,
    workspaceId: workspace!.id,
    projectId: project!.id,
    cleanup: async () => {
      await db.delete(workspaces).where(eq(workspaces.id, workspace!.id));
      await db.delete(user).where(eq(user.id, userId));
    },
  };
}
