import { describe, it, expect, afterEach } from "vitest";
import { createApp } from "../src/app.js";
import {
  seedWorkspace,
  setPagePermission,
  type SeedResult,
} from "./helpers/seed.js";
import { signSessionCookie } from "./helpers/session.js";

const app = createApp();

async function authedFetch(
  path: string,
  userId: string,
): Promise<Response> {
  const cookie = await signSessionCookie(userId);
  return app.request(path, { headers: { cookie } });
}

describe("GET /api/projects/:projectId/permissions", () => {
  const cleanups: SeedResult[] = [];
  afterEach(async () => {
    for (const s of cleanups.splice(0)) await s.cleanup();
  });

  it("returns owner role for workspace owner", async () => {
    const seed = await seedWorkspace({ role: "owner" });
    cleanups.push(seed);

    const res = await authedFetch(
      `/api/projects/${seed.projectId}/permissions`,
      seed.userId,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.role).toBe("owner");
    expect(body.overrides).toEqual({});
  });

  it("returns editor role for editor + empty overrides", async () => {
    const seed = await seedWorkspace({ role: "editor" });
    cleanups.push(seed);

    const res = await authedFetch(
      `/api/projects/${seed.projectId}/permissions`,
      seed.userId,
    );
    const body = await res.json();
    expect(body.role).toBe("editor");
    expect(body.overrides).toEqual({});
  });

  it("returns viewer role + page-level override for explicitly granted note", async () => {
    const seed = await seedWorkspace({ role: "viewer" });
    cleanups.push(seed);
    // Grant the viewer an explicit editor override on seed's note.
    await setPagePermission(seed.userId, seed.noteId, "editor");

    const res = await authedFetch(
      `/api/projects/${seed.projectId}/permissions`,
      seed.userId,
    );
    const body = await res.json();
    expect(body.role).toBe("viewer");
    expect(body.overrides[seed.noteId]).toBe("editor");
  });

  it("omits overrides for notes in other projects", async () => {
    const seed = await seedWorkspace({ role: "owner" });
    const other = await seedWorkspace({ role: "owner" });
    cleanups.push(seed, other);

    // Grant the seed user an override on a note in `other` project.
    // The permissions call for `seed.projectId` must NOT leak it.
    await setPagePermission(seed.userId, other.noteId, "viewer");

    const res = await authedFetch(
      `/api/projects/${seed.projectId}/permissions`,
      seed.userId,
    );
    const body = await res.json();
    expect(body.overrides[other.noteId]).toBeUndefined();
  });

  it("returns 403 to non-members", async () => {
    const inside = await seedWorkspace({ role: "owner" });
    const outside = await seedWorkspace({ role: "owner" });
    cleanups.push(inside, outside);

    const res = await authedFetch(
      `/api/projects/${inside.projectId}/permissions`,
      outside.userId,
    );
    expect(res.status).toBe(403);
  });

  it("returns 400 for non-uuid projectId", async () => {
    const seed = await seedWorkspace({ role: "owner" });
    cleanups.push(seed);

    const res = await authedFetch(
      `/api/projects/not-a-uuid/permissions`,
      seed.userId,
    );
    expect(res.status).toBe(400);
  });
});
