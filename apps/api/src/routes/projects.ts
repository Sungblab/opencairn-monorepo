import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import {
  db,
  projects,
  folders,
  notes,
  pagePermissions,
  researchRuns,
  projectTreeNodes,
  eq,
  desc,
  and,
  isNull,
  isNotNull,
} from "@opencairn/db";
import {
  createProjectSchema,
  getResolvedProjectTemplate,
  projectTemplateApplyRequestSchema,
  updateProjectSchema,
} from "@opencairn/shared";
import { requireAuth } from "../middleware/auth";
import { canRead, canWrite, resolveRole } from "../lib/permissions";
import { requireWorkspaceRole } from "../middleware/require-role";
import { isUuid } from "../lib/validators";
import {
  ensureProjectTreeBackfill,
  listTreeChildren,
  listTreeChildrenForParents,
} from "../lib/project-tree-service";
import { requeueNoteAnalysisJobForNote } from "../lib/note-analysis-jobs";
import { buildProjectWikiIndex } from "../lib/project-wiki-index";
import type { AppEnv } from "../lib/types";

const PROJECT_WIKI_REFRESH_NOTE_LIMIT = 100;

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

  // App Shell Phase 5 Task 2 — project view 의 노트 테이블 데이터 소스.
  // ?filter=all|imported|research|manual 로 4-tab UI가 직접 매핑.
  // 분류 규칙:
  //   research = research_runs.note_id 가 set된 노트 (Phase D 산출물)
  //   imported = sourceType in (pdf|audio|video|image|youtube|web|notion|unknown)
  //              AND research 가 아닌 것
  //   manual   = sourceType IN (NULL, 'manual', 'canvas') 또는 위 두 그룹에서 빠진 것
  //   all      = 전체
  // 응답 키는 snake_case 로 dashboard endpoint들과 일관 (kind / updated_at).
  // Soft-deleted 는 항상 제외.
  .get("/projects/:id/notes", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "Bad Request" }, 400);
    if (!(await canRead(user.id, { type: "project", id }))) {
      return c.json({ error: "Forbidden" }, 403);
    }
    const filterRaw = c.req.query("filter") ?? "all";
    const filter = (
      ["all", "imported", "research", "manual"] as const
    ).includes(filterRaw as never)
      ? (filterRaw as "all" | "imported" | "research" | "manual")
      : "all";

    const runRows = await db
      .select({ noteId: researchRuns.noteId })
      .from(researchRuns)
      .where(
        and(
          eq(researchRuns.projectId, id),
          isNotNull(researchRuns.noteId),
        ),
      );
    const researchNoteIds = new Set(
      runRows.map((r) => r.noteId).filter((v): v is string => v != null),
    );

    const rows = await db
      .select({
        id: notes.id,
        title: notes.title,
        sourceType: notes.sourceType,
        updatedAt: notes.updatedAt,
      })
      .from(notes)
      .where(and(eq(notes.projectId, id), isNull(notes.deletedAt)))
      .orderBy(desc(notes.updatedAt));

    const IMPORTED_SOURCE_TYPES = new Set([
      "pdf",
      "audio",
      "video",
      "image",
      "youtube",
      "web",
      "notion",
      "unknown",
    ]);

    const annotated = rows.map((n) => {
      const isResearch = researchNoteIds.has(n.id);
      const isImported =
        !isResearch &&
        n.sourceType != null &&
        IMPORTED_SOURCE_TYPES.has(n.sourceType);
      const kind: "research" | "imported" | "manual" = isResearch
        ? "research"
        : isImported
          ? "imported"
          : "manual";
      return {
        id: n.id,
        title: n.title,
        kind,
        updated_at: n.updatedAt.toISOString(),
      };
    });

    const filtered =
      filter === "all" ? annotated : annotated.filter((n) => n.kind === filter);
    return c.json({ notes: filtered });
  })

  .get("/projects/:id/wiki-index", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "Bad Request" }, 400);
    if (!(await canRead(user.id, { type: "project", id }))) {
      return c.json({ error: "Forbidden" }, 403);
    }

    return c.json(
      await buildProjectWikiIndex({ projectId: id, userId: user.id }),
    );
  })

  .post("/projects/:id/wiki-index/refresh", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "Bad Request" }, 400);
    if (!(await canWrite(user.id, { type: "project", id }))) {
      return c.json({ error: "Forbidden" }, 403);
    }

    const noteRows = await db
      .select({
        id: notes.id,
        inheritParent: notes.inheritParent,
      })
      .from(notes)
      .where(and(eq(notes.projectId, id), isNull(notes.deletedAt)))
      .orderBy(desc(notes.updatedAt))
      .limit(PROJECT_WIKI_REFRESH_NOTE_LIMIT);

    const noteIds = (
      await Promise.all(
        noteRows.map(async (note) => {
          if (
            note.inheritParent === false &&
            !(await canWrite(user.id, { type: "note", id: note.id }))
          ) {
            return null;
          }
          return note.id;
        }),
      )
    ).filter((noteId): noteId is string => noteId !== null);

    const queueResults = await Promise.all(
      noteIds.map((noteId) =>
        requeueNoteAnalysisJobForNote({
          noteId,
          projectId: id,
          debounceMs: 0,
        }),
      ),
    );

    return c.json(
      {
        projectId: id,
        noteIds,
        queuedNoteAnalysisJobs: queueResults.filter(
          (result) => result.status === "queued",
        ).length,
        skippedNotes: noteRows.length - noteIds.length,
        limit: PROJECT_WIKI_REFRESH_NOTE_LIMIT,
      },
      202,
    );
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

  .post(
    "/workspaces/:workspaceId/project-templates/apply",
    requireWorkspaceRole("member"),
    zValidator("json", projectTemplateApplyRequestSchema),
    async (c) => {
      const workspaceId = c.req.param("workspaceId");
      if (!isUuid(workspaceId)) return c.json({ error: "Bad Request" }, 400);
      const user = c.get("user");
      const body = c.req.valid("json");
      const template = getResolvedProjectTemplate(
        body.templateId,
        c.req.header("accept-language"),
      );
      if (!template) return c.json({ error: "template_not_found" }, 404);

      const created = await db.transaction(async (tx) => {
        const createdProjects: Array<{
          id: string;
          name: string;
          notes: Array<{ id: string; title: string }>;
        }> = [];

        for (const templateProject of template.projects) {
          const [project] = await tx
            .insert(projects)
            .values({
              workspaceId,
              name: templateProject.name,
              description: templateProject.description,
              createdBy: user.id,
            })
            .returning({ id: projects.id, name: projects.name });

          const createdNotes: Array<{ id: string; title: string }> = [];
          for (const templateNote of templateProject.notes) {
            const [note] = await tx
              .insert(notes)
              .values({
                projectId: project.id,
                workspaceId,
                title: templateNote.title,
                contentText: templateNote.contentText,
                content: [
                  {
                    type: "p",
                    children: [{ text: templateNote.contentText }],
                  },
                ],
                sourceType: "manual",
                inheritParent: true,
              })
              .returning({ id: notes.id, title: notes.title });
            createdNotes.push(note);
          }

          createdProjects.push({
            id: project.id,
            name: project.name,
            notes: createdNotes,
          });
        }

        return createdProjects;
      });

      return c.json({ templateId: template.id, projects: created }, 201);
    },
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

  // 사이드바 트리 (/api/projects/:projectId/tree[?parent_id=...]).
  // folders + notes를 `kind` discriminator로 묶어 한 번에 반환. `parent_id`는
  // 반드시 이 프로젝트에 속한 folder id 이어야 하며, 값이 비어 있으면 root
  // (folders.parent_id IS NULL + notes.folder_id IS NULL)를 돌려준다.
  // 폴더 노드 각각은 1단계 손자(children)를 프리패치해 사이드바의 첫 확장
  // 클릭에서 추가 round-trip이 없도록 한다. Phase 2 spec §4.6.1 / §11.3.
  .get("/projects/:projectId/tree", async (c) => {
    const user = c.get("user");
    const projectId = c.req.param("projectId");
    if (!isUuid(projectId)) return c.json({ error: "Bad Request" }, 400);
    if (!(await canRead(user.id, { type: "project", id: projectId }))) {
      return c.json({ error: "Forbidden" }, 403);
    }

    const parentIdRaw = c.req.query("parent_id");
    let parentId: string | null = null;
    await ensureProjectTreeBackfill(projectId);
    if (parentIdRaw !== undefined && parentIdRaw !== "") {
      if (!isUuid(parentIdRaw)) return c.json({ error: "Bad Request" }, 400);
      const [parent] = await db
        .select({ id: projectTreeNodes.id })
        .from(projectTreeNodes)
        .where(
          and(
            eq(projectTreeNodes.id, parentIdRaw),
            eq(projectTreeNodes.projectId, projectId),
          ),
        );
      if (!parent) {
        return c.json(
          { error: "parent_id must be a tree node in this project" },
          400,
        );
      }
      parentId = parentIdRaw;
    }

    const roots = await listTreeChildren({ projectId, parentId });

    // Prefetch one level of children for every folder that has any. Notes
    // are leaves and don't need prefetching.
    const folderParents = roots
      .filter((r) => r.childCount > 0)
      .map((r) => r.id);
    const grouped = await listTreeChildrenForParents({
      projectId,
      parentIds: folderParents,
    });

    return c.json({
      nodes: roots.map((r) => ({
        kind: r.kind,
        id: r.id,
        parent_id: r.parentId,
        label: r.label,
        child_count: r.childCount,
        target_table: r.targetTable,
        target_id: r.targetId,
        icon: r.icon,
        metadata: r.metadata,
        file_kind: r.fileKind ?? null,
        mime_type: r.mimeType ?? null,
        children:
          r.childCount > 0
            ? (grouped.get(r.id) ?? []).map((ch) => ({
                kind: ch.kind,
                id: ch.id,
                parent_id: ch.parentId,
                label: ch.label,
                child_count: ch.childCount,
                target_table: ch.targetTable,
                target_id: ch.targetId,
                icon: ch.icon,
                metadata: ch.metadata,
                file_kind: ch.fileKind ?? null,
                mime_type: ch.mimeType ?? null,
              }))
            : [],
      })),
    });
  })

  // 사이드바 권한 배칭 (/api/projects/:projectId/permissions).
  // 효과적인 프로젝트 role 하나 + 이 프로젝트 내부 노트에 대한 per-user
  // page_permissions override 맵을 한 번에 돌려준다. 사이드바는 마운트 시점에
  // 이걸 한 번 호출하고, 이후 렌더 루프에서는 per-node 권한 체크를 절대로
  // 하지 않는다 (spec §4.6.1, §4.10 — "per-node perm check in render loop").
  .get("/projects/:projectId/permissions", async (c) => {
    const user = c.get("user");
    const projectId = c.req.param("projectId");
    if (!isUuid(projectId)) return c.json({ error: "Bad Request" }, 400);

    const role = await resolveRole(user.id, { type: "project", id: projectId });
    if (role === "none") return c.json({ error: "Forbidden" }, 403);

    // Scope overrides to notes in THIS project — a user's pagePermissions
    // in other projects are irrelevant to this sidebar and shouldn't leak.
    const overrideRows = await db
      .select({
        pageId: pagePermissions.pageId,
        role: pagePermissions.role,
      })
      .from(pagePermissions)
      .innerJoin(notes, eq(notes.id, pagePermissions.pageId))
      .where(
        and(
          eq(pagePermissions.userId, user.id),
          eq(notes.projectId, projectId),
        ),
      );

    const overrides: Record<string, string> = {};
    for (const row of overrideRows) overrides[row.pageId] = row.role;

    return c.json({ role, overrides });
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
