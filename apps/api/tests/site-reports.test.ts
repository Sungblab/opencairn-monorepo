import { afterEach, describe, expect, it } from "vitest";
import { db, eq, siteAdminReports, user } from "@opencairn/db";
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

async function authedPost(path: string, userId: string, body: unknown): Promise<Response> {
  const cookie = await signSessionCookie(userId);
  return app.request(path, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("site reports", () => {
  it("lets authenticated users submit bug reports", async () => {
    const reporter = await makeUser();

    const res = await authedPost("/api/site-reports", reporter.id, {
      type: "bug",
      priority: "high",
      title: "Sidebar does not open",
      description: "The sidebar button does nothing.",
      pageUrl: "http://localhost:3000/ko/dashboard",
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { report: { id: string; status: string } };
    expect(body.report.status).toBe("open");
    createdReports.add(body.report.id);

    const [row] = await db
      .select({
        reporterUserId: siteAdminReports.reporterUserId,
        title: siteAdminReports.title,
        priority: siteAdminReports.priority,
      })
      .from(siteAdminReports)
      .where(eq(siteAdminReports.id, body.report.id));
    expect(row).toMatchObject({
      reporterUserId: reporter.id,
      title: "Sidebar does not open",
      priority: "high",
    });
  });
});
