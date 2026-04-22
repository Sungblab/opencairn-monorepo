import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db, workspaces, workspaceMembers, projects, and, eq } from "@opencairn/db";
import { requireAuth } from "../middleware/auth";
import { requireWorkspaceRole } from "../middleware/require-role";
import { isUuid } from "../lib/validators";
import type { AppEnv } from "../lib/types";

// Keep in sync with apps/web/src/lib/slug.ts RESERVED_SLUGS.
const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "app", "api", "admin", "auth", "www", "assets", "static", "public",
  "health", "onboarding", "settings", "billing", "share",
  "invite", "invites", "help", "docs", "blog",
]);

const createSchema = z.object({
  name: z.string().min(1).max(120),
  slug: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .min(3)
    .max(40)
    .refine((s) => !RESERVED_SLUGS.has(s), { message: "reserved_slug" })
    .optional(),
});

// Derive an ASCII slug from a workspace name. Returns null if the name yields
// something too short or reserved — caller should fall back to randomSlug().
function deriveSlugFromName(name: string): string | null {
  const ascii = name
    .toLowerCase()
    .replace(/[^\x00-\x7f]+/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]+/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  if (ascii.length < 3) return null;
  if (RESERVED_SLUGS.has(ascii)) return null;
  return ascii;
}

function randomSlug(): string {
  return `w-${randomBytes(4).toString("hex")}`;
}

export const workspaceRoutes = new Hono<AppEnv>().use("*", requireAuth);

// 내 workspaces 목록 — minimal projection for redirect/list flows
workspaceRoutes.get("/", async (c) => {
  const user = c.get("user");
  const rows = await db
    .select({
      id: workspaces.id,
      slug: workspaces.slug,
      name: workspaces.name,
      role: workspaceMembers.role,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, user.id));
  return c.json(rows);
});

// slug → workspace 조회 (멤버만 접근). /app/w/:wsSlug redirect chain 용.
workspaceRoutes.get("/by-slug/:slug", async (c) => {
  const user = c.get("user");
  const slug = c.req.param("slug");
  const [row] = await db
    .select({
      id: workspaces.id,
      slug: workspaces.slug,
      name: workspaces.name,
      role: workspaceMembers.role,
    })
    .from(workspaces)
    .innerJoin(
      workspaceMembers,
      and(eq(workspaceMembers.workspaceId, workspaces.id), eq(workspaceMembers.userId, user.id))
    )
    .where(eq(workspaces.slug, slug));
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json(row);
});

// workspace 생성 — 생성자가 자동 owner. slug 미지정 시 이름에서 자동 파생
// (ASCII 추출 실패/충돌 시 `w-{random}` fallback).
workspaceRoutes.post("/", zValidator("json", createSchema), async (c) => {
  const user = c.get("user");
  const body = c.req.valid("json");

  const userProvidedSlug = body.slug !== undefined;
  const candidates: string[] = [];
  if (body.slug) {
    candidates.push(body.slug);
  } else {
    const derived = deriveSlugFromName(body.name);
    if (derived) candidates.push(derived);
    for (let i = 0; i < 3; i++) candidates.push(randomSlug());
  }

  for (const slug of candidates) {
    try {
      const ws = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(workspaces)
          .values({ name: body.name, slug, ownerId: user.id })
          .returning();
        await tx
          .insert(workspaceMembers)
          .values({ workspaceId: created.id, userId: user.id, role: "owner" });
        // Auto-create a first project so new users land on a usable page
        // instead of an empty workspace. User can rename or delete later.
        await tx
          .insert(projects)
          .values({ workspaceId: created.id, name: body.name, createdBy: user.id });
        return created;
      });
      return c.json(ws, 201);
    } catch (err: unknown) {
      // DrizzleQueryError wraps the underlying PostgresError in `cause`;
      // fall back to top-level `code` for direct driver errors.
      const code =
        (err as { code?: string; cause?: { code?: string } } | null)?.code ??
        (err as { cause?: { code?: string } } | null)?.cause?.code;
      if (code === "23505") {
        // Honor user-supplied slug — surface conflict immediately.
        if (userProvidedSlug) return c.json({ error: "slug_conflict" }, 409);
        continue;
      }
      throw err;
    }
  }
  return c.json({ error: "slug_conflict" }, 409);
});

// 특정 workspace 조회
workspaceRoutes.get("/:workspaceId", requireWorkspaceRole("member"), async (c) => {
  const id = c.req.param("workspaceId");
  if (!isUuid(id)) return c.json({ error: "Bad Request" }, 400);
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, id));
  return c.json(ws);
});

// 멤버 목록
workspaceRoutes.get("/:workspaceId/members", requireWorkspaceRole("member"), async (c) => {
  const id = c.req.param("workspaceId");
  if (!isUuid(id)) return c.json({ error: "Bad Request" }, 400);
  const members = await db.select().from(workspaceMembers).where(eq(workspaceMembers.workspaceId, id));
  return c.json(members);
});

// 역할 변경 (admin 이상)
workspaceRoutes.patch(
  "/:workspaceId/members/:userId",
  requireWorkspaceRole("admin"),
  zValidator("json", z.object({ role: z.enum(["admin", "member", "guest"]) })),
  async (c) => {
    const { workspaceId, userId } = c.req.param();
    if (!isUuid(workspaceId)) return c.json({ error: "Bad Request" }, 400);
    const { role } = c.req.valid("json");
    const [target] = await db.select({ role: workspaceMembers.role }).from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)));
    if (target?.role === "owner") return c.json({ error: "Cannot change workspace owner role" }, 403);
    await db.update(workspaceMembers).set({ role })
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)));
    return c.json({ ok: true });
  }
);

// 멤버 제거 (admin 이상; owner 제거는 불가)
workspaceRoutes.delete("/:workspaceId/members/:userId", requireWorkspaceRole("admin"), async (c) => {
  const { workspaceId, userId } = c.req.param();
  if (!isUuid(workspaceId)) return c.json({ error: "Bad Request" }, 400);
  // owner는 제거 금지 — 현재 role이 owner면 403
  const [target] = await db.select({ role: workspaceMembers.role }).from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)));
  if (target?.role === "owner") return c.json({ error: "Cannot remove workspace owner" }, 403);
  await db.delete(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)));
  return c.json({ ok: true });
});
