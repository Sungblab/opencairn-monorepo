import { randomBytes, randomUUID } from "node:crypto";
import { describe, it, expect, afterEach } from "vitest";
import {
  db,
  workspaces,
  workspaceMembers,
  workspaceInvites,
  projects,
  notes,
  researchRuns,
  userPreferences,
  user,
  eq,
} from "@opencairn/db";
import { createApp } from "../src/app.js";
import { createUser } from "./helpers/seed.js";
import { signSessionCookie } from "./helpers/session.js";

const app = createApp();

const createdWorkspaceSlugs = new Set<string>();
const createdWorkspaceIds = new Set<string>();
const createdUserIds = new Set<string>();

async function authedPost(
  path: string,
  body: unknown,
): Promise<{ res: Response; userId: string }> {
  const u = await createUser();
  createdUserIds.add(u.id);
  const cookie = await signSessionCookie(u.id);
  const res = await app.request(path, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  // Track slug for cleanup if created
  if (res.status === 201) {
    const clone = res.clone();
    try {
      const json = (await clone.json()) as { slug?: string };
      if (json.slug) createdWorkspaceSlugs.add(json.slug);
    } catch {
      // ignore parse
    }
  }
  return { res, userId: u.id };
}

async function authedGet(
  path: string,
  userId: string,
): Promise<Response> {
  const cookie = await signSessionCookie(userId);
  return app.request(path, { headers: { cookie } });
}

async function seedMembership(
  userId: string,
  opts: { role?: "owner" | "admin" | "member" | "guest"; name?: string } = {},
): Promise<{ workspaceId: string; slug: string }> {
  const workspaceId = randomUUID();
  const slug = `test-ws-${workspaceId.slice(0, 8)}`;
  await db.insert(workspaces).values({
    id: workspaceId,
    slug,
    name: opts.name ?? "Test Workspace",
    ownerId: userId,
    planType: "free",
  });
  createdWorkspaceIds.add(workspaceId);
  createdWorkspaceSlugs.add(slug);
  await db.insert(workspaceMembers).values({
    workspaceId,
    userId,
    role: opts.role ?? "owner",
  });
  return { workspaceId, slug };
}

async function seedInvite(
  workspaceId: string,
  email: string,
  opts: { acceptedAt?: Date; expiresAt?: Date } = {},
): Promise<string> {
  const id = randomUUID();
  const expiresAt =
    opts.expiresAt ?? new Date(Date.now() + 1000 * 60 * 60 * 24);
  await db.insert(workspaceInvites).values({
    id,
    workspaceId,
    email,
    role: "member",
    token: randomBytes(16).toString("hex"),
    expiresAt,
    acceptedAt: opts.acceptedAt ?? null,
  });
  return id;
}

async function cleanup(): Promise<void> {
  for (const slug of createdWorkspaceSlugs) {
    await db.delete(workspaces).where(eq(workspaces.slug, slug));
  }
  createdWorkspaceSlugs.clear();
  createdWorkspaceIds.clear();
  for (const id of createdUserIds) {
    await db.delete(user).where(eq(user.id, id));
  }
  createdUserIds.clear();
}

describe("POST /api/workspaces reserved-slug validation", () => {
  afterEach(cleanup);

  it.each(["app", "api", "admin", "auth", "onboarding", "billing"])(
    "rejects reserved slug %s",
    async (slug) => {
      const { res } = await authedPost("/api/workspaces", {
        name: "Test",
        slug,
      });
      expect(res.status).toBe(400);
    },
  );

  it("accepts a non-reserved slug", async () => {
    const { res } = await authedPost("/api/workspaces", {
      name: "Test",
      slug: "my-team",
    });
    expect(res.status).toBe(201);
  });

  it("returns 409 on slug conflict", async () => {
    await authedPost("/api/workspaces", { name: "A", slug: "dup-slug" });
    const { res } = await authedPost("/api/workspaces", {
      name: "B",
      slug: "dup-slug",
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("slug_conflict");
  });

  it("rejects slug shorter than 3 chars", async () => {
    const { res } = await authedPost("/api/workspaces", {
      name: "Test",
      slug: "ab",
    });
    expect(res.status).toBe(400);
  });

  it("rejects slug longer than 40 chars", async () => {
    const { res } = await authedPost("/api/workspaces", {
      name: "Test",
      slug: "a".repeat(41),
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/workspaces slug auto-generation", () => {
  afterEach(cleanup);

  it("derives slug from ASCII-compatible name when slug omitted", async () => {
    const { res } = await authedPost("/api/workspaces", { name: "My Team" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { slug: string };
    expect(body.slug).toBe("my-team");
  });

  it("falls back to `home-{hex}` when name has no ASCII", async () => {
    const { res } = await authedPost("/api/workspaces", { name: "내 작업공간" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { slug: string };
    expect(body.slug).toMatch(/^home-[a-f0-9]{8}$/);
  });

  it("auto-retries on derived-slug conflict with random fallback", async () => {
    // Occupy the ASCII-derived slug first.
    const first = await authedPost("/api/workspaces", {
      name: "Shared Name",
      slug: "shared-name",
    });
    expect(first.res.status).toBe(201);
    // Second call omits slug; derived clashes -> must fall back to home-{hex}.
    const { res } = await authedPost("/api/workspaces", {
      name: "Shared Name",
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { slug: string };
    expect(body.slug).toMatch(/^home-[a-f0-9]{8}$/);
  });

  it("respects user-supplied slug even when conflict would be auto-recoverable", async () => {
    await authedPost("/api/workspaces", { name: "A", slug: "taken" });
    const { res } = await authedPost("/api/workspaces", {
      name: "B",
      slug: "taken",
    });
    expect(res.status).toBe(409);
  });

  it("creates the first project with a project-specific default name", async () => {
    const { res } = await authedPost("/api/workspaces", {
      name: "성빈's workspace",
      slug: "sungbin-auto-project",
    });
    expect(res.status).toBe(201);
    const workspace = (await res.json()) as { id: string };
    createdWorkspaceIds.add(workspace.id);

    const [project] = await db
      .select({ name: projects.name })
      .from(projects)
      .where(eq(projects.workspaceId, workspace.id));

    expect(project?.name).toBe("내 첫 프로젝트");
  });
});

describe("POST /api/workspaces/:workspaceId/project-templates/apply", () => {
  afterEach(cleanup);

  async function authedTemplatePost(
    workspaceId: string,
    userId: string,
    templateId: string,
  ): Promise<Response> {
    const cookie = await signSessionCookie(userId);
    return app.request(`/api/workspaces/${workspaceId}/project-templates/apply`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ templateId }),
    });
  }

  it("creates the four core school subject projects with starter notes", async () => {
    const u = await createUser();
    createdUserIds.add(u.id);
    const { workspaceId } = await seedMembership(u.id);

    const res = await authedTemplatePost(workspaceId, u.id, "school_subjects");

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      projects: Array<{ name: string; notes: Array<{ title: string }> }>;
    };
    expect(body.projects.map((project) => project.name)).toEqual([
      "국어",
      "수학",
      "영어",
      "과학",
    ]);
    expect(body.projects.every((project) => project.notes.length > 0)).toBe(true);

    const rows = await db
      .select({ title: notes.title })
      .from(notes)
      .where(eq(notes.workspaceId, workspaceId));
    expect(rows).toHaveLength(16);
  });

  it("creates an empty first project template without starter notes", async () => {
    const u = await createUser();
    createdUserIds.add(u.id);
    const { workspaceId } = await seedMembership(u.id);

    const res = await authedTemplatePost(workspaceId, u.id, "empty_project");

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      projects: Array<{ name: string; notes: Array<{ title: string }> }>;
    };
    expect(body.projects).toEqual([
      expect.objectContaining({ name: "내 첫 프로젝트", notes: [] }),
    ]);
  });

  it("rejects template application for a non-member", async () => {
    const owner = await createUser();
    const outsider = await createUser();
    createdUserIds.add(owner.id);
    createdUserIds.add(outsider.id);
    const { workspaceId } = await seedMembership(owner.id);

    const res = await authedTemplatePost(workspaceId, outsider.id, "empty_project");

    expect(res.status).toBe(403);
  });
});

describe("GET /api/workspaces/me", () => {
  afterEach(cleanup);

  it("returns empty arrays for user with no memberships or invites", async () => {
    const u = await createUser();
    createdUserIds.add(u.id);
    const res = await authedGet("/api/workspaces/me", u.id);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      workspaces: unknown[];
      invites: unknown[];
    };
    expect(body.workspaces).toEqual([]);
    expect(body.invites).toEqual([]);
  });

  it("returns workspaces the user is a member of with role", async () => {
    const u = await createUser();
    createdUserIds.add(u.id);
    const { workspaceId, slug } = await seedMembership(u.id, {
      role: "owner",
      name: "ACME",
    });
    const res = await authedGet("/api/workspaces/me", u.id);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      workspaces: Array<{
        id: string;
        slug: string;
        name: string;
        role: string;
      }>;
    };
    expect(body.workspaces).toHaveLength(1);
    expect(body.workspaces[0]).toMatchObject({
      id: workspaceId,
      slug,
      name: "ACME",
      role: "owner",
    });
  });

  it("includes pending invites addressed to the user's email", async () => {
    const inviter = await createUser();
    createdUserIds.add(inviter.id);
    const invitee = await createUser();
    createdUserIds.add(invitee.id);
    const { workspaceId } = await seedMembership(inviter.id, {
      name: "Invite Land",
    });
    const inviteId = await seedInvite(workspaceId, invitee.email);

    const res = await authedGet("/api/workspaces/me", invitee.id);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      invites: Array<{
        id: string;
        workspaceId: string;
        workspaceName: string;
        role: string;
      }>;
    };
    expect(body.invites).toHaveLength(1);
    expect(body.invites[0]).toMatchObject({
      id: inviteId,
      workspaceId,
      workspaceName: "Invite Land",
    });
  });

  it("excludes accepted or expired invites", async () => {
    const inviter = await createUser();
    createdUserIds.add(inviter.id);
    const invitee = await createUser();
    createdUserIds.add(invitee.id);
    const { workspaceId } = await seedMembership(inviter.id);
    // accepted invite
    await seedInvite(workspaceId, invitee.email, {
      acceptedAt: new Date(),
    });
    // expired invite (into a second workspace — partial unique allows it)
    const other = await seedMembership(inviter.id, { name: "Other" });
    await seedInvite(other.workspaceId, invitee.email, {
      expiresAt: new Date(Date.now() - 1000),
    });

    const res = await authedGet("/api/workspaces/me", invitee.id);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { invites: unknown[] };
    expect(body.invites).toEqual([]);
  });

  it("excludes invites addressed to other emails", async () => {
    const inviter = await createUser();
    createdUserIds.add(inviter.id);
    const me = await createUser();
    createdUserIds.add(me.id);
    const { workspaceId } = await seedMembership(inviter.id);
    await seedInvite(workspaceId, "someone-else@example.com");

    const res = await authedGet("/api/workspaces/me", me.id);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { invites: unknown[] };
    expect(body.invites).toEqual([]);
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await app.request("/api/workspaces/me");
    expect(res.status).toBe(401);
  });
});

// App Shell Phase 5 Task 1 — dashboard 카드 4장의 데이터 소스. snake_case 응답
// 키 (docs / docs_week_delta / research_in_progress / credits_krw / byok_connected)
// 는 클라이언트가 그대로 분해해 카드에 매핑하므로 이름 자체가 계약이다.
describe("GET /api/workspaces/:workspaceId/stats", () => {
  afterEach(cleanup);

  async function seedNote(
    workspaceId: string,
    projectId: string,
    opts: { createdAt?: Date; deletedAt?: Date } = {},
  ): Promise<string> {
    const id = randomUUID();
    await db.insert(notes).values({
      id,
      projectId,
      workspaceId,
      title: "n",
      inheritParent: true,
      createdAt: opts.createdAt,
      updatedAt: opts.createdAt,
      deletedAt: opts.deletedAt ?? null,
    });
    return id;
  }

  async function seedProject(
    workspaceId: string,
    ownerId: string,
  ): Promise<string> {
    const id = randomUUID();
    await db.insert(projects).values({
      id,
      workspaceId,
      name: "p",
      createdBy: ownerId,
    });
    return id;
  }

  it("returns zero counts and disconnected BYOK on empty workspace", async () => {
    const u = await createUser();
    createdUserIds.add(u.id);
    const { workspaceId } = await seedMembership(u.id);
    const res = await authedGet(`/api/workspaces/${workspaceId}/stats`, u.id);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      docs: 0,
      docs_week_delta: 0,
      research_in_progress: 0,
      credits_krw: 0,
      byok_connected: false,
    });
  });

  it("counts non-deleted notes plus this-week delta", async () => {
    const u = await createUser();
    createdUserIds.add(u.id);
    const { workspaceId } = await seedMembership(u.id);
    const projectId = await seedProject(workspaceId, u.id);
    const now = Date.now();
    // 2 notes within the last week
    await seedNote(workspaceId, projectId, {
      createdAt: new Date(now - 60 * 1000),
    });
    await seedNote(workspaceId, projectId, {
      createdAt: new Date(now - 24 * 60 * 60 * 1000),
    });
    // 1 note older than 7 days
    await seedNote(workspaceId, projectId, {
      createdAt: new Date(now - 30 * 24 * 60 * 60 * 1000),
    });
    // 1 soft-deleted note (must not count towards docs at all)
    await seedNote(workspaceId, projectId, {
      createdAt: new Date(now - 60 * 1000),
      deletedAt: new Date(),
    });

    const res = await authedGet(`/api/workspaces/${workspaceId}/stats`, u.id);
    const body = (await res.json()) as { docs: number; docs_week_delta: number };
    expect(body.docs).toBe(3);
    expect(body.docs_week_delta).toBe(2);
  });

  it("counts only active research statuses", async () => {
    const u = await createUser();
    createdUserIds.add(u.id);
    const { workspaceId } = await seedMembership(u.id);
    const projectId = await seedProject(workspaceId, u.id);

    const insertRun = async (status: "planning" | "awaiting_approval" | "researching" | "completed" | "failed" | "cancelled") => {
      const id = randomUUID();
      await db.insert(researchRuns).values({
        id,
        workspaceId,
        projectId,
        userId: u.id,
        topic: "t",
        model: "deep-research-preview-04-2026",
        billingPath: "managed",
        status,
        workflowId: id,
      });
    };
    await insertRun("planning");
    await insertRun("awaiting_approval");
    await insertRun("researching");
    await insertRun("completed");
    await insertRun("failed");
    await insertRun("cancelled");

    const res = await authedGet(`/api/workspaces/${workspaceId}/stats`, u.id);
    const body = (await res.json()) as { research_in_progress: number };
    expect(body.research_in_progress).toBe(3);
  });

  it("reports byok_connected when user_preferences holds an encrypted key", async () => {
    const u = await createUser();
    createdUserIds.add(u.id);
    const { workspaceId } = await seedMembership(u.id);
    await db.insert(userPreferences).values({
      userId: u.id,
      byokApiKeyEncrypted: Buffer.from("ciphertext-blob"),
    });
    const res = await authedGet(`/api/workspaces/${workspaceId}/stats`, u.id);
    const body = (await res.json()) as { byok_connected: boolean };
    expect(body.byok_connected).toBe(true);
  });

  it("returns 403 for non-member", async () => {
    const owner = await createUser();
    createdUserIds.add(owner.id);
    const outsider = await createUser();
    createdUserIds.add(outsider.id);
    const { workspaceId } = await seedMembership(owner.id);
    const res = await authedGet(
      `/api/workspaces/${workspaceId}/stats`,
      outsider.id,
    );
    expect(res.status).toBe(403);
  });

  it("returns 401 when unauthenticated", async () => {
    const id = randomUUID();
    const res = await app.request(`/api/workspaces/${id}/stats`);
    expect(res.status).toBe(401);
  });

  it("rejects non-member access on malformed id", async () => {
    const u = await createUser();
    createdUserIds.add(u.id);
    const res = await authedGet("/api/workspaces/not-a-uuid/stats", u.id);
    // requireWorkspaceRole runs before isUuid; an invalid uuid surfaces as
    // either a permission error (403) or a query error (500) — the contract
    // we care about is "caller cannot read stats", not the exact code.
    expect(res.status).not.toBe(200);
  });
});

describe("GET /api/workspaces/:workspaceId/recent-notes", () => {
  afterEach(cleanup);

  async function seedProject(
    workspaceId: string,
    ownerId: string,
  ): Promise<string> {
    const id = randomUUID();
    await db.insert(projects).values({
      id,
      workspaceId,
      name: `proj-${id.slice(0, 4)}`,
      createdBy: ownerId,
    });
    return id;
  }
  async function seedNote(
    workspaceId: string,
    projectId: string,
    title: string,
    updatedAt: Date,
    opts: { deletedAt?: Date; inheritParent?: boolean } = {},
  ): Promise<string> {
    const id = randomUUID();
    await db.insert(notes).values({
      id,
      projectId,
      workspaceId,
      title,
      inheritParent: opts.inheritParent ?? true,
      createdAt: updatedAt,
      updatedAt,
      deletedAt: opts.deletedAt ?? null,
    });
    return id;
  }

  it("returns notes ordered by updated_at desc with project_name joined", async () => {
    const u = await createUser();
    createdUserIds.add(u.id);
    const { workspaceId } = await seedMembership(u.id);
    const projectId = await seedProject(workspaceId, u.id);
    const oldest = new Date(Date.now() - 3 * 60 * 60 * 1000);
    const middle = new Date(Date.now() - 60 * 60 * 1000);
    const newest = new Date(Date.now() - 60 * 1000);
    await seedNote(workspaceId, projectId, "a", oldest);
    await seedNote(workspaceId, projectId, "b", middle);
    await seedNote(workspaceId, projectId, "c", newest);

    const res = await authedGet(
      `/api/workspaces/${workspaceId}/recent-notes`,
      u.id,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      notes: Array<{ title: string; project_name: string }>;
    };
    expect(body.notes.map((n) => n.title)).toEqual(["c", "b", "a"]);
    expect(body.notes[0].project_name).toMatch(/^proj-/);
  });

  it("excludes soft-deleted notes", async () => {
    const u = await createUser();
    createdUserIds.add(u.id);
    const { workspaceId } = await seedMembership(u.id);
    const projectId = await seedProject(workspaceId, u.id);
    await seedNote(workspaceId, projectId, "alive", new Date());
    await seedNote(workspaceId, projectId, "gone", new Date(), {
      deletedAt: new Date(),
    });
    const res = await authedGet(
      `/api/workspaces/${workspaceId}/recent-notes`,
      u.id,
    );
    const body = (await res.json()) as { notes: Array<{ title: string }> };
    expect(body.notes.map((n) => n.title)).toEqual(["alive"]);
  });

  it("excludes private notes the member cannot read and still fills the requested limit", async () => {
    const u = await createUser();
    createdUserIds.add(u.id);
    const { workspaceId } = await seedMembership(u.id, { role: "member" });
    const projectId = await seedProject(workspaceId, u.id);

    await seedNote(
      workspaceId,
      projectId,
      "private newest",
      new Date(Date.now() + 2 * 60 * 1000),
      { inheritParent: false },
    );
    await seedNote(
      workspaceId,
      projectId,
      "public middle",
      new Date(Date.now() + 60 * 1000),
    );
    await seedNote(workspaceId, projectId, "public oldest", new Date());

    const res = await authedGet(
      `/api/workspaces/${workspaceId}/recent-notes?limit=2`,
      u.id,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { notes: Array<{ title: string }> };
    expect(body.notes.map((n) => n.title)).toEqual([
      "public middle",
      "public oldest",
    ]);
  });

  it("fills the requested limit even when private notes exceed the old overfetch window", async () => {
    const u = await createUser();
    createdUserIds.add(u.id);
    const { workspaceId } = await seedMembership(u.id, { role: "member" });
    const projectId = await seedProject(workspaceId, u.id);

    for (let i = 0; i < 5; i++) {
      await seedNote(
        workspaceId,
        projectId,
        `private-${i}`,
        new Date(Date.now() + (10 - i) * 60 * 1000),
        { inheritParent: false },
      );
    }
    await seedNote(
      workspaceId,
      projectId,
      "public newer",
      new Date(Date.now() + 60 * 1000),
    );
    await seedNote(workspaceId, projectId, "public older", new Date());

    const res = await authedGet(
      `/api/workspaces/${workspaceId}/recent-notes?limit=2`,
      u.id,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { notes: Array<{ title: string }> };
    expect(body.notes.map((n) => n.title)).toEqual([
      "public newer",
      "public older",
    ]);
  });

  it("clamps limit to 1..50 and defaults to 5", async () => {
    const u = await createUser();
    createdUserIds.add(u.id);
    const { workspaceId } = await seedMembership(u.id);
    const projectId = await seedProject(workspaceId, u.id);
    for (let i = 0; i < 7; i++) {
      await seedNote(
        workspaceId,
        projectId,
        `n-${i}`,
        new Date(Date.now() - i * 60 * 1000),
      );
    }
    // default
    const def = await authedGet(
      `/api/workspaces/${workspaceId}/recent-notes`,
      u.id,
    );
    expect(((await def.json()) as { notes: unknown[] }).notes).toHaveLength(5);
    // explicit small
    const two = await authedGet(
      `/api/workspaces/${workspaceId}/recent-notes?limit=2`,
      u.id,
    );
    expect(((await two.json()) as { notes: unknown[] }).notes).toHaveLength(2);
    // invalid → default
    const bad = await authedGet(
      `/api/workspaces/${workspaceId}/recent-notes?limit=abc`,
      u.id,
    );
    expect(((await bad.json()) as { notes: unknown[] }).notes).toHaveLength(5);
    // over upper bound clamped (only 7 rows so still 7)
    const huge = await authedGet(
      `/api/workspaces/${workspaceId}/recent-notes?limit=999`,
      u.id,
    );
    expect(((await huge.json()) as { notes: unknown[] }).notes).toHaveLength(7);
  });

  it("returns 403 for non-member", async () => {
    const owner = await createUser();
    createdUserIds.add(owner.id);
    const outsider = await createUser();
    createdUserIds.add(outsider.id);
    const { workspaceId } = await seedMembership(owner.id);
    const res = await authedGet(
      `/api/workspaces/${workspaceId}/recent-notes`,
      outsider.id,
    );
    expect(res.status).toBe(403);
  });
});

// App Shell Phase 5 Task 8 — palette workspace note search.
describe("GET /api/workspaces/:workspaceId/notes/search", () => {
  afterEach(cleanup);

  async function seedProject(
    workspaceId: string,
    ownerId: string,
  ): Promise<string> {
    const id = randomUUID();
    await db.insert(projects).values({
      id,
      workspaceId,
      name: "p",
      createdBy: ownerId,
    });
    return id;
  }
  async function seedNote(
    workspaceId: string,
    projectId: string,
    title: string,
    opts: { deletedAt?: Date; inheritParent?: boolean; updatedAt?: Date } = {},
  ): Promise<string> {
    const id = randomUUID();
    await db.insert(notes).values({
      id,
      projectId,
      workspaceId,
      title,
      inheritParent: opts.inheritParent ?? true,
      updatedAt: opts.updatedAt,
      deletedAt: opts.deletedAt ?? null,
    });
    return id;
  }

  it("returns empty results for blank query", async () => {
    const u = await createUser();
    createdUserIds.add(u.id);
    const { workspaceId } = await seedMembership(u.id);
    const res = await authedGet(
      `/api/workspaces/${workspaceId}/notes/search?q=`,
      u.id,
    );
    const body = (await res.json()) as { results: unknown[] };
    expect(body.results).toEqual([]);
  });

  it("matches title case-insensitively and joins project_name", async () => {
    const u = await createUser();
    createdUserIds.add(u.id);
    const { workspaceId } = await seedMembership(u.id);
    const projectId = await seedProject(workspaceId, u.id);
    await seedNote(workspaceId, projectId, "Quantum Computing");
    await seedNote(workspaceId, projectId, "Cooking Recipes");
    const res = await authedGet(
      `/api/workspaces/${workspaceId}/notes/search?q=quantum`,
      u.id,
    );
    const body = (await res.json()) as {
      results: Array<{ title: string; project_name: string }>;
    };
    expect(body.results).toHaveLength(1);
    expect(body.results[0].title).toBe("Quantum Computing");
    expect(body.results[0].project_name).toBe("p");
  });

  it("excludes soft-deleted notes", async () => {
    const u = await createUser();
    createdUserIds.add(u.id);
    const { workspaceId } = await seedMembership(u.id);
    const projectId = await seedProject(workspaceId, u.id);
    await seedNote(workspaceId, projectId, "alive");
    await seedNote(workspaceId, projectId, "alive-tombstone", {
      deletedAt: new Date(),
    });
    const res = await authedGet(
      `/api/workspaces/${workspaceId}/notes/search?q=alive`,
      u.id,
    );
    const body = (await res.json()) as { results: Array<{ title: string }> };
    expect(body.results.map((r) => r.title)).toEqual(["alive"]);
  });

  it("excludes private notes the member cannot read and still fills the requested limit", async () => {
    const u = await createUser();
    createdUserIds.add(u.id);
    const { workspaceId } = await seedMembership(u.id, { role: "member" });
    const projectId = await seedProject(workspaceId, u.id);
    await seedNote(workspaceId, projectId, "needle private newest", {
      inheritParent: false,
      updatedAt: new Date(Date.now() + 2 * 60 * 1000),
    });
    await seedNote(workspaceId, projectId, "needle public middle", {
      updatedAt: new Date(Date.now() + 60 * 1000),
    });
    await seedNote(workspaceId, projectId, "needle public oldest", {
      updatedAt: new Date(),
    });

    const res = await authedGet(
      `/api/workspaces/${workspaceId}/notes/search?q=needle&limit=2`,
      u.id,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: Array<{ title: string }> };
    expect(body.results.map((r) => r.title)).toEqual([
      "needle public middle",
      "needle public oldest",
    ]);
  });

  it("fills the requested search limit even when private notes exceed the old overfetch window", async () => {
    const u = await createUser();
    createdUserIds.add(u.id);
    const { workspaceId } = await seedMembership(u.id, { role: "member" });
    const projectId = await seedProject(workspaceId, u.id);

    for (let i = 0; i < 5; i++) {
      await seedNote(workspaceId, projectId, `needle private-${i}`, {
        inheritParent: false,
        updatedAt: new Date(Date.now() + (10 - i) * 60 * 1000),
      });
    }
    await seedNote(workspaceId, projectId, "needle public newer", {
      updatedAt: new Date(Date.now() + 60 * 1000),
    });
    await seedNote(workspaceId, projectId, "needle public older", {
      updatedAt: new Date(),
    });

    const res = await authedGet(
      `/api/workspaces/${workspaceId}/notes/search?q=needle&limit=2`,
      u.id,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: Array<{ title: string }> };
    expect(body.results.map((r) => r.title)).toEqual([
      "needle public newer",
      "needle public older",
    ]);
  });

  it("returns 403 for non-member", async () => {
    const owner = await createUser();
    createdUserIds.add(owner.id);
    const outsider = await createUser();
    createdUserIds.add(outsider.id);
    const { workspaceId } = await seedMembership(owner.id);
    const res = await authedGet(
      `/api/workspaces/${workspaceId}/notes/search?q=foo`,
      outsider.id,
    );
    expect(res.status).toBe(403);
  });
});
