import { describe, it, expect, afterEach } from "vitest";
import { db, workspaces, user, eq } from "@opencairn/db";
import { createApp } from "../src/app.js";
import { createUser } from "./helpers/seed.js";
import { signSessionCookie } from "./helpers/session.js";

const app = createApp();

const createdWorkspaceSlugs = new Set<string>();
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

async function cleanup(): Promise<void> {
  for (const slug of createdWorkspaceSlugs) {
    await db.delete(workspaces).where(eq(workspaces.slug, slug));
  }
  createdWorkspaceSlugs.clear();
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

  it("falls back to `w-{hex}` when name has no ASCII", async () => {
    const { res } = await authedPost("/api/workspaces", { name: "내 작업공간" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { slug: string };
    expect(body.slug).toMatch(/^w-[a-f0-9]{8}$/);
  });

  it("auto-retries on derived-slug conflict with random fallback", async () => {
    // Occupy the ASCII-derived slug first.
    const first = await authedPost("/api/workspaces", {
      name: "Shared Name",
      slug: "shared-name",
    });
    expect(first.res.status).toBe(201);
    // Second call omits slug; derived clashes → must fall back to w-{hex}.
    const { res } = await authedPost("/api/workspaces", {
      name: "Shared Name",
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { slug: string };
    expect(body.slug).toMatch(/^w-[a-f0-9]{8}$/);
  });

  it("respects user-supplied slug even when conflict would be auto-recoverable", async () => {
    await authedPost("/api/workspaces", { name: "A", slug: "taken" });
    const { res } = await authedPost("/api/workspaces", {
      name: "B",
      slug: "taken",
    });
    expect(res.status).toBe(409);
  });
});
