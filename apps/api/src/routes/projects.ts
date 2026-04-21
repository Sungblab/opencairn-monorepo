import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { db, projects, eq, desc } from "@opencairn/db";
import { createProjectSchema, updateProjectSchema } from "@opencairn/shared";
import { requireAuth } from "../middleware/auth";
import { canRead, canWrite, resolveRole } from "../lib/permissions";
import { requireWorkspaceRole } from "../middleware/require-role";
import { isUuid } from "../lib/validators";
import type { AppEnv } from "../lib/types";

export const projectRoutes = new Hono<AppEnv>()
  .use("*", requireAuth)

  // 워크스페이스 내 프로젝트 목록 (URL: /api/workspaces/:workspaceId/projects)
  .get("/workspaces/:workspaceId/projects", requireWorkspaceRole("member"), async (c) => {
    const workspaceId = c.req.param("workspaceId");
    if (!isUuid(workspaceId)) return c.json({ error: "Bad Request" }, 400);
    const user = c.get("user");
    const rows = await db
      .select()
      .from(projects)
      .where(eq(projects.workspaceId, workspaceId))
      .orderBy(desc(projects.createdAt));
    // owner/admin은 workspace 내 모든 project 읽기 가능 — per-project canRead 생략
    const wsRole = c.get("wsRole");
    let visible;
    if (wsRole === "owner" || wsRole === "admin") {
      visible = rows;
    } else {
      const checks = await Promise.all(
        rows.map(async (p) => ({ p, ok: await canRead(user.id, { type: "project", id: p.id }) }))
      );
      visible = checks.filter((x) => x.ok).map((x) => x.p);
    }
    return c.json(visible);
  })

  // 단일 프로젝트 조회 (/api/projects/:id)
  .get("/projects/:id", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "Bad Request" }, 400);
    if (!(await canRead(user.id, { type: "project", id }))) return c.json({ error: "Forbidden" }, 403);
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, id));
    if (!project) return c.json({ error: "Not found" }, 404);
    return c.json(project);
  })

  // 생성: workspace-scoped (/api/workspaces/:workspaceId/projects)
  .post(
    "/workspaces/:workspaceId/projects",
    requireWorkspaceRole("member"),
    zValidator("json", createProjectSchema),
    async (c) => {
      const workspaceId = c.req.param("workspaceId");
      if (!isUuid(workspaceId)) return c.json({ error: "Bad Request" }, 400);
      const user = c.get("user");
      const body = c.req.valid("json");
      const [project] = await db
        .insert(projects)
        .values({ ...body, workspaceId, createdBy: user.id })
        .returning();
      return c.json(project, 201);
    }
  )

  // 수정 (/api/projects/:id, editor 이상 필요)
  .patch("/projects/:id", zValidator("json", updateProjectSchema), async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "Bad Request" }, 400);
    if (!(await canWrite(user.id, { type: "project", id }))) return c.json({ error: "Forbidden" }, 403);
    const body = c.req.valid("json");
    const [project] = await db
      .update(projects)
      .set(body)
      .where(eq(projects.id, id))
      .returning();
    if (!project) return c.json({ error: "Not found" }, 404);
    return c.json(project);
  })

  // 삭제 (workspace admin 이상 또는 생성자)
  .delete("/projects/:id", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "Bad Request" }, 400);
    const [proj] = await db.select().from(projects).where(eq(projects.id, id));
    if (!proj) return c.json({ error: "Not found" }, 404);
    const role = await resolveRole(user.id, { type: "workspace", id: proj.workspaceId });
    const isCreator = proj.createdBy === user.id;
    if (!["owner", "admin"].includes(role) && !isCreator) return c.json({ error: "Forbidden" }, 403);
    await db.delete(projects).where(eq(projects.id, id));
    return c.json({ success: true });
  });
