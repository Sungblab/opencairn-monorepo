import { afterEach, describe, expect, it } from "vitest";
import {
  adminAuditEvents,
  db,
  eq,
  siteAdminReports,
  sql,
  user,
  workspaces,
} from "@opencairn/db";
import { createApp } from "../src/app.js";
import { createUser, type CreatedUser } from "./helpers/seed.js";
import { signSessionCookie } from "./helpers/session.js";

const app = createApp();
const createdUsers = new Set<string>();
const createdReports = new Set<string>();
const createdWorkspaces = new Set<string>();

afterEach(async () => {
  for (const id of createdWorkspaces) {
    await db
      .delete(adminAuditEvents)
      .where(eq(adminAuditEvents.targetWorkspaceId, id));
  }
  for (const id of createdReports) {
    await db
      .delete(adminAuditEvents)
      .where(eq(adminAuditEvents.targetReportId, id));
  }
  for (const id of createdUsers) {
    await db
      .delete(adminAuditEvents)
      .where(eq(adminAuditEvents.actorUserId, id));
    await db
      .delete(adminAuditEvents)
      .where(eq(adminAuditEvents.targetUserId, id));
  }
  for (const id of createdReports) {
    await db.delete(siteAdminReports).where(eq(siteAdminReports.id, id));
  }
  createdReports.clear();
  for (const id of createdWorkspaces) {
    await db.delete(workspaces).where(eq(workspaces.id, id));
  }
  createdWorkspaces.clear();
  for (const id of createdUsers) {
    await db.delete(user).where(eq(user.id, id));
  }
  createdUsers.clear();
});

async function makeUser(): Promise<CreatedUser> {
  const created = await createUser();
  createdUsers.add(created.id);
  return created;
}

async function promoteSiteAdmin(userId: string): Promise<void> {
  await db.execute(sql`
    update "user"
    set is_site_admin = true
    where id = ${userId}
  `);
}

async function makeWorkspace(ownerId: string) {
  const [workspace] = await db
    .insert(workspaces)
    .values({
      ownerId,
      slug: `admin-audit-${crypto.randomUUID().slice(0, 8)}`,
      name: "Admin audit workspace",
    })
    .returning({ id: workspaces.id });
  createdWorkspaces.add(workspace.id);
  return workspace;
}

async function authedGet(path: string, userId: string): Promise<Response> {
  const cookie = await signSessionCookie(userId);
  return app.request(path, { headers: { cookie } });
}

async function authedPatch(
  path: string,
  userId: string,
  body: unknown,
): Promise<Response> {
  const cookie = await signSessionCookie(userId);
  return app.request(path, {
    method: "PATCH",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("site admin routes", () => {
  it("rejects non-site-admin users", async () => {
    const caller = await makeUser();

    const res = await authedGet("/api/admin/users", caller.id);

    expect(res.status).toBe(403);
  });

  it("lists users for site admins", async () => {
    const caller = await makeUser();
    const target = await makeUser();
    await promoteSiteAdmin(caller.id);

    const res = await authedGet("/api/admin/users", caller.id);

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      users: Array<{ id: string; email: string; isSiteAdmin: boolean }>;
    };
    expect(body.users).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: caller.id,
          email: caller.email,
          isSiteAdmin: true,
        }),
        expect.objectContaining({
          id: target.id,
          email: target.email,
          isSiteAdmin: false,
        }),
      ]),
    );
  });

  it("lets site admins grant site admin access", async () => {
    const caller = await makeUser();
    const target = await makeUser();
    await promoteSiteAdmin(caller.id);

    const res = await authedPatch(
      `/api/admin/users/${target.id}/site-admin`,
      caller.id,
      { isSiteAdmin: true },
    );

    expect(res.status).toBe(200);
    const [row] = await db
      .select({ isSiteAdmin: user.isSiteAdmin })
      .from(user)
      .where(eq(user.id, target.id));
    expect(row?.isSiteAdmin).toBe(true);

    const [event] = await db
      .select()
      .from(adminAuditEvents)
      .where(eq(adminAuditEvents.targetUserId, target.id));
    expect(event).toMatchObject({
      actorUserId: caller.id,
      action: "site_admin.grant",
      targetUserId: target.id,
    });
    expect(event?.before).toMatchObject({ isSiteAdmin: false });
    expect(event?.after).toMatchObject({ isSiteAdmin: true });
  });

  it("prevents unsafe site admin self-removal", async () => {
    const caller = await makeUser();
    await promoteSiteAdmin(caller.id);

    const res = await authedPatch(
      `/api/admin/users/${caller.id}/site-admin`,
      caller.id,
      { isSiteAdmin: false },
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: expect.stringMatching(
        /^cannot_remove_(last_site_admin|own_site_admin)$/,
      ),
    });
  });

  it("lets site admins update user plans", async () => {
    const caller = await makeUser();
    const target = await makeUser();
    await promoteSiteAdmin(caller.id);

    const res = await authedPatch(
      `/api/admin/users/${target.id}/plan`,
      caller.id,
      { plan: "pro" },
    );

    expect(res.status).toBe(200);
    const [row] = await db
      .select({ plan: user.plan })
      .from(user)
      .where(eq(user.id, target.id));
    expect(row?.plan).toBe("pro");

    const [event] = await db
      .select()
      .from(adminAuditEvents)
      .where(eq(adminAuditEvents.targetUserId, target.id));
    expect(event).toMatchObject({
      actorUserId: caller.id,
      action: "user.plan.update",
      targetUserId: target.id,
    });
    expect(event?.before).toMatchObject({ plan: "free" });
    expect(event?.after).toMatchObject({ plan: "pro" });
  });

  it("lets site admins update multiple user plans at once", async () => {
    const caller = await makeUser();
    const targetA = await makeUser();
    const targetB = await makeUser();
    await promoteSiteAdmin(caller.id);

    const res = await authedPatch("/api/admin/users/plan", caller.id, {
      userIds: [targetA.id, targetB.id],
      plan: "pro",
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ updated: 2 });
    const rows = await db
      .select({ id: user.id, plan: user.plan })
      .from(user)
      .where(sql`${user.id} in (${targetA.id}, ${targetB.id})`);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: targetA.id, plan: "pro" }),
        expect.objectContaining({ id: targetB.id, plan: "pro" }),
      ]),
    );

    const events = await db
      .select()
      .from(adminAuditEvents)
      .where(sql`${adminAuditEvents.targetUserId} in (${targetA.id}, ${targetB.id})`);
    expect(events).toHaveLength(2);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "user.plan.update" }),
      ]),
    );
  });

  it("lets site admins grant site admin access to multiple users at once", async () => {
    const caller = await makeUser();
    const targetA = await makeUser();
    const targetB = await makeUser();
    await promoteSiteAdmin(caller.id);

    const res = await authedPatch("/api/admin/users/site-admin", caller.id, {
      userIds: [targetA.id, targetB.id],
      isSiteAdmin: true,
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ updated: 2 });
    const rows = await db
      .select({ id: user.id, isSiteAdmin: user.isSiteAdmin })
      .from(user)
      .where(sql`${user.id} in (${targetA.id}, ${targetB.id})`);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: targetA.id, isSiteAdmin: true }),
        expect.objectContaining({ id: targetB.id, isSiteAdmin: true }),
      ]),
    );
  });

  it("records workspace plan changes and exposes audit events", async () => {
    const caller = await makeUser();
    await promoteSiteAdmin(caller.id);
    const workspace = await makeWorkspace(caller.id);

    const update = await authedPatch(
      `/api/admin/workspaces/${workspace.id}/plan`,
      caller.id,
      { planType: "enterprise" },
    );
    expect(update.status).toBe(200);

    const res = await authedGet("/api/admin/audit-events", caller.id);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      events: Array<{
        action: string;
        actorUserId: string | null;
        targetWorkspaceId: string | null;
        before: Record<string, unknown>;
        after: Record<string, unknown>;
      }>;
    };
    expect(body.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "workspace.plan.update",
          actorUserId: caller.id,
          targetWorkspaceId: workspace.id,
          before: { planType: "free" },
          after: { planType: "enterprise" },
        }),
      ]),
    );
  });

  it("lets site admins update multiple workspace plans at once", async () => {
    const caller = await makeUser();
    await promoteSiteAdmin(caller.id);
    const workspaceA = await makeWorkspace(caller.id);
    const workspaceB = await makeWorkspace(caller.id);

    const update = await authedPatch("/api/admin/workspaces/plan", caller.id, {
      workspaceIds: [workspaceA.id, workspaceB.id],
      planType: "enterprise",
    });
    expect(update.status).toBe(200);
    await expect(update.json()).resolves.toEqual({ updated: 2 });

    const rows = await db
      .select({ id: workspaces.id, planType: workspaces.planType })
      .from(workspaces)
      .where(sql`${workspaces.id} in (${workspaceA.id}, ${workspaceB.id})`);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: workspaceA.id, planType: "enterprise" }),
        expect.objectContaining({ id: workspaceB.id, planType: "enterprise" }),
      ]),
    );
  });

  it("lists and transitions site reports for admins", async () => {
    const caller = await makeUser();
    const reporter = await makeUser();
    await promoteSiteAdmin(caller.id);
    const [report] = await db
      .insert(siteAdminReports)
      .values({
        reporterUserId: reporter.id,
        title: "Editor crash",
        description: "The editor crashed after paste.",
        priority: "high",
      })
      .returning({ id: siteAdminReports.id });
    createdReports.add(report.id);

    const list = await authedGet("/api/admin/reports", caller.id);
    expect(list.status).toBe(200);
    await expect(list.json()).resolves.toEqual(
      expect.objectContaining({
        reports: expect.arrayContaining([
          expect.objectContaining({ id: report.id, title: "Editor crash" }),
        ]),
      }),
    );

    const update = await authedPatch(
      `/api/admin/reports/${report.id}/status`,
      caller.id,
      { status: "resolved" },
    );
    expect(update.status).toBe(200);
    const [row] = await db
      .select({
        status: siteAdminReports.status,
        resolvedByUserId: siteAdminReports.resolvedByUserId,
      })
      .from(siteAdminReports)
      .where(eq(siteAdminReports.id, report.id));
    expect(row).toMatchObject({
      status: "resolved",
      resolvedByUserId: caller.id,
    });

    const [event] = await db
      .select()
      .from(adminAuditEvents)
      .where(eq(adminAuditEvents.targetReportId, report.id));
    expect(event).toMatchObject({
      actorUserId: caller.id,
      action: "report.status.update",
      targetReportId: report.id,
    });
    expect(event?.before).toMatchObject({ status: "open" });
    expect(event?.after).toMatchObject({ status: "resolved" });
  });

  it("lets site admins transition multiple site reports at once", async () => {
    const caller = await makeUser();
    const reporter = await makeUser();
    await promoteSiteAdmin(caller.id);
    const inserted = await db
      .insert(siteAdminReports)
      .values([
        {
          reporterUserId: reporter.id,
          title: "First report",
          description: "First description",
          priority: "normal",
        },
        {
          reporterUserId: reporter.id,
          title: "Second report",
          description: "Second description",
          priority: "high",
        },
      ])
      .returning({ id: siteAdminReports.id });
    for (const report of inserted) createdReports.add(report.id);

    const update = await authedPatch("/api/admin/reports/status", caller.id, {
      reportIds: inserted.map((report) => report.id),
      status: "closed",
    });
    expect(update.status).toBe(200);
    await expect(update.json()).resolves.toEqual({ updated: 2 });

    const rows = await db
      .select({ id: siteAdminReports.id, status: siteAdminReports.status })
      .from(siteAdminReports)
      .where(
        sql`${siteAdminReports.id} in (${inserted[0]!.id}, ${inserted[1]!.id})`,
      );
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: inserted[0]!.id, status: "closed" }),
        expect.objectContaining({ id: inserted[1]!.id, status: "closed" }),
      ]),
    );
  });
});
