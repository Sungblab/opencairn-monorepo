import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  db,
  workspaces,
  workspaceMembers,
  workspaceInvites,
  projects,
  projectPermissions,
  notes,
  pagePermissions,
  researchRuns,
  user,
  userPreferences,
  and,
  eq,
  gt,
  isNull,
  desc,
  count,
  inArray,
  sql,
} from "@opencairn/db";
import { requireAuth } from "../middleware/auth";
import { requireWorkspaceRole } from "../middleware/require-role";
import { isUuid } from "../lib/validators";
import type { AppEnv } from "../lib/types";

// Keep in sync with apps/web/src/lib/slug.ts RESERVED_SLUGS.
const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "app", "api", "admin", "auth", "www", "assets", "static", "public",
  "health", "onboarding", "settings", "billing", "share",
  "invite", "invites", "help", "docs", "blog",
  "workspace", "dashboard", "project", "note",
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

// 현재 사용자의 workspace 멤버십 + 나에게 온 pending 초대.
// 사이드바 스위처/대시보드 모두 이 한 번의 호출로 필요한 정보를 읽는다.
// pending = acceptedAt IS NULL AND expiresAt > now(). 이메일 매칭.
workspaceRoutes.get("/me", async (c) => {
  const u = c.get("user");
  const ws = await db
    .select({
      id: workspaces.id,
      slug: workspaces.slug,
      name: workspaces.name,
      role: workspaceMembers.role,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, u.id));

  const email = (u as { email?: string | null }).email;
  const invites = email
    ? await db
        .select({
          id: workspaceInvites.id,
          workspaceId: workspaceInvites.workspaceId,
          workspaceName: workspaces.name,
          workspaceSlug: workspaces.slug,
          role: workspaceInvites.role,
          expiresAt: workspaceInvites.expiresAt,
        })
        .from(workspaceInvites)
        .innerJoin(workspaces, eq(workspaces.id, workspaceInvites.workspaceId))
        .where(
          and(
            eq(workspaceInvites.email, email),
            isNull(workspaceInvites.acceptedAt),
            gt(workspaceInvites.expiresAt, new Date())
          )
        )
    : [];

  return c.json({ workspaces: ws, invites });
});

// slug → workspace 조회 (멤버만 접근). /:locale/workspace/:wsSlug redirect chain 용.
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

// 멤버 목록 — workspace settings → members 탭 직렬화 형태로 반환.
// user 정보(이름/이메일)를 join해 한 번의 호출로 표시 가능하게.
workspaceRoutes.get("/:workspaceId/members", requireWorkspaceRole("member"), async (c) => {
  const id = c.req.param("workspaceId");
  if (!isUuid(id)) return c.json({ error: "Bad Request" }, 400);
  const members = await db
    .select({
      userId: workspaceMembers.userId,
      role: workspaceMembers.role,
      email: user.email,
      name: user.name,
    })
    .from(workspaceMembers)
    .innerJoin(user, eq(user.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.workspaceId, id));
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

// 대시보드 헤더 카드 4장 집계 (App Shell Phase 5 Task 1).
// 응답은 snake_case로 고정 — 클라이언트에서 그대로 분해해 카드에 매핑한다.
// credits_krw 는 Plan 9b billing 도착 전까지 stub 0. byok_connected 는 사용자
// 본인의 BYOK 키 (legacy users 컬럼 또는 user_preferences 신규 컬럼) 어느 쪽이든
// 등록되어 있으면 true.
workspaceRoutes.get(
  "/:workspaceId/stats",
  requireWorkspaceRole("member"),
  async (c) => {
    const workspaceId = c.req.param("workspaceId");
    if (!isUuid(workspaceId)) return c.json({ error: "Bad Request" }, 400);
    const userId = c.get("user").id;
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [docsTotal] = await db
      .select({ n: count() })
      .from(notes)
      .where(and(eq(notes.workspaceId, workspaceId), isNull(notes.deletedAt)));
    const [docsWeek] = await db
      .select({ n: count() })
      .from(notes)
      .where(
        and(
          eq(notes.workspaceId, workspaceId),
          isNull(notes.deletedAt),
          gt(notes.createdAt, weekAgo),
        ),
      );
    const [researchActive] = await db
      .select({ n: count() })
      .from(researchRuns)
      .where(
        and(
          eq(researchRuns.workspaceId, workspaceId),
          inArray(researchRuns.status, [
            "planning",
            "awaiting_approval",
            "researching",
          ]),
        ),
      );
    const [legacyByok] = await db
      .select({ key: user.byokGeminiKeyCiphertext })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);
    const [prefByok] = await db
      .select({ key: userPreferences.byokApiKeyEncrypted })
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .limit(1);

    return c.json({
      docs: docsTotal.n,
      docs_week_delta: docsWeek.n,
      research_in_progress: researchActive.n,
      credits_krw: 0,
      byok_connected: legacyByok?.key != null || prefByok?.key != null,
    });
  },
);

// Command Palette (App Shell Phase 5 Task 8) workspace 노트 검색. Title ILIKE
// 만 사용하는 minimal 구현 — Postgres FTS / pg_trgm 으로의 확장은 별도 plan
// (text-search exploration). q 가 비면 빈 배열, limit 1..50.
workspaceRoutes.get(
  "/:workspaceId/notes/search",
  requireWorkspaceRole("member"),
  async (c) => {
    const workspaceId = c.req.param("workspaceId");
    if (!isUuid(workspaceId)) return c.json({ error: "Bad Request" }, 400);
    const q = c.req.query("q")?.trim() ?? "";
    if (q.length < 1) return c.json({ results: [] });
    const limitRaw = c.req.query("limit");
    const limitParsed = Number.parseInt(limitRaw ?? "20", 10);
    const limit = Number.isFinite(limitParsed)
      ? Math.max(1, Math.min(50, limitParsed))
      : 20;
    const userId = c.get("user").id;
    const rows = await db
      .select({
        id: notes.id,
        title: notes.title,
        project_id: notes.projectId,
        project_name: projects.name,
        updated_at: notes.updatedAt,
      })
      .from(notes)
      .innerJoin(projects, eq(projects.id, notes.projectId))
      .innerJoin(
        workspaceMembers,
        and(
          eq(workspaceMembers.workspaceId, notes.workspaceId),
          eq(workspaceMembers.userId, userId),
        ),
      )
      .leftJoin(
        pagePermissions,
        and(
          eq(pagePermissions.pageId, notes.id),
          eq(pagePermissions.userId, userId),
        ),
      )
      .leftJoin(
        projectPermissions,
        and(
          eq(projectPermissions.projectId, notes.projectId),
          eq(projectPermissions.userId, userId),
        ),
      )
      .where(
        and(
          eq(notes.workspaceId, workspaceId),
          isNull(notes.deletedAt),
          sql`${notes.title} ILIKE ${"%" + q + "%"}`,
          readableNoteSql(),
        ),
      )
      .orderBy(desc(notes.updatedAt))
      .limit(limit);

    return c.json({ results: rows });
  },
);

// 대시보드 우측 카드 — 최근 업데이트된 노트 N개 (App Shell Phase 5 Task 1).
// limit 1~50 (기본 5). Workspace member gate 뒤에도 private page 제목이
// 새지 않도록 note 단위 canRead로 한 번 더 필터링한다. mentions/search와
// 동일하게 overfetch 후 limit까지 잘라 response shape는 유지한다.
workspaceRoutes.get(
  "/:workspaceId/recent-notes",
  requireWorkspaceRole("member"),
  async (c) => {
    const workspaceId = c.req.param("workspaceId");
    if (!isUuid(workspaceId)) return c.json({ error: "Bad Request" }, 400);
    const limitRaw = c.req.query("limit");
    const limitParsed = Number.parseInt(limitRaw ?? "5", 10);
    const limit = Number.isFinite(limitParsed)
      ? Math.max(1, Math.min(50, limitParsed))
      : 5;
    const userId = c.get("user").id;

    const rows = await db
      .select({
        id: notes.id,
        title: notes.title,
        project_id: notes.projectId,
        project_name: projects.name,
        updated_at: notes.updatedAt,
        content_text: notes.contentText,
      })
      .from(notes)
      .innerJoin(projects, eq(projects.id, notes.projectId))
      .innerJoin(
        workspaceMembers,
        and(
          eq(workspaceMembers.workspaceId, notes.workspaceId),
          eq(workspaceMembers.userId, userId),
        ),
      )
      .leftJoin(
        pagePermissions,
        and(
          eq(pagePermissions.pageId, notes.id),
          eq(pagePermissions.userId, userId),
        ),
      )
      .leftJoin(
        projectPermissions,
        and(
          eq(projectPermissions.projectId, notes.projectId),
          eq(projectPermissions.userId, userId),
        ),
      )
      .where(
        and(
          eq(notes.workspaceId, workspaceId),
          isNull(notes.deletedAt),
          readableNoteSql(),
        ),
      )
      .orderBy(desc(notes.updatedAt))
      .limit(limit);

    // Mockup §dashboard recent-docs cards show a 1-line excerpt; we slice
    // the indexed `content_text` to ~120 chars and collapse whitespace so
    // the API doesn't ship full note bodies down. Note that `content_text`
    // can be empty for a brand-new note — fall back to null in that case.
    const shaped = rows.map(({ content_text, ...rest }) => ({
      ...rest,
      excerpt:
        typeof content_text === "string" && content_text.trim().length > 0
          ? content_text.replace(/\s+/g, " ").trim().slice(0, 120)
          : null,
    }));

    return c.json({ notes: shaped });
  },
);

// Plan 2C Task 4 — workspace member search powering the ShareDialog
// "Invite people" panel. Gated to workspace members (any role); ILIKE on
// name OR email, capped at 10 results. Empty query returns an empty list
// rather than firing an unbounded scan.
workspaceRoutes.get(
  "/:workspaceId/members/search",
  requireWorkspaceRole("member"),
  async (c) => {
    const wsId = c.req.param("workspaceId");
    if (!isUuid(wsId)) return c.json({ error: "Bad Request" }, 400);
    const q = c.req.query("q")?.trim() ?? "";
    if (q.length < 1) return c.json({ members: [] });
    const rows = await db
      .select({
        userId: workspaceMembers.userId,
        role: workspaceMembers.role,
        name: user.name,
        email: user.email,
      })
      .from(workspaceMembers)
      .innerJoin(user, eq(user.id, workspaceMembers.userId))
      .where(
        and(
          eq(workspaceMembers.workspaceId, wsId),
          sql`(${user.name} ILIKE ${"%" + q + "%"} OR ${user.email} ILIKE ${"%" + q + "%"})`,
        ),
      )
      .limit(10);
    return c.json({ members: rows });
  },
);

function readableNoteSql() {
  return sql`(
    ${workspaceMembers.role} IN ('owner', 'admin')
    OR (${pagePermissions.role} IS NOT NULL AND ${pagePermissions.role} <> 'none')
    OR (
      ${pagePermissions.role} IS NULL
      AND ${notes.inheritParent} = true
      AND (
        ${projectPermissions.role} IS NOT NULL
        OR ${workspaceMembers.role} = 'member'
      )
    )
  )`;
}
