import { afterEach, describe, expect, it } from "vitest";
import { db, eq, siteAdminReports, sql, user } from "@opencairn/db";
import { createApp } from "../src/app.js";
import { createUser, type CreatedUser } from "./helpers/seed.js";
import { signSessionCookie } from "./helpers/session.js";

const app = createApp();
const createdUsers = new Set<string>();
const createdReports = new Set<string>();

afterEach(async () => {
  for (const id of createdReports) {
    await db.delete(siteAdminReports).where(eq(siteAdminReports.id, id));
  }
  createdReports.clear();
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
  });

  it("prevents site admins from removing their own admin access", async () => {
    const caller = await makeUser();
    await promoteSiteAdmin(caller.id);

    const res = await authedPatch(
      `/api/admin/users/${caller.id}/site-admin`,
      caller.id,
      { isSiteAdmin: false },
    );

    expect(res.status).toBe(400);
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
    expect(row).toMatchObject({ status: "resolved", resolvedByUserId: caller.id });
  });
});
