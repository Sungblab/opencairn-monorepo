import { test, expect } from "@playwright/test";
import {
  applySessionCookie,
  seedAndSignIn,
  type SeededSession,
} from "./helpers/seed-session";

// App Shell Phase 2 sidebar coverage. Mirrors the Phase 1 shell spec's
// auth pattern: the internal /test-seed endpoint mints a workspace +
// project + note and we attach the Better Auth cookie to the browser
// context before navigating.
//
// Execution is deferred along with the rest of the Phase 1/2 E2E suite
// (per plans-status.md — parallel dev server not wired yet). Running
// locally: `pnpm --filter @opencairn/web dev` in one shell, then
// `pnpm --filter @opencairn/web test:e2e tests/e2e/sidebar.spec.ts`.

test.describe("App Shell sidebar", () => {
  let session: SeededSession;

  test.beforeEach(async ({ context, request }) => {
    session = await seedAndSignIn(request);
    await applySessionCookie(context, session);
  });

  test("renders sidebar shell with workspace switcher + global nav", async ({
    page,
  }) => {
    await page.goto(`/ko/workspace/${session.wsSlug}/`);
    await expect(page.getByTestId("app-shell-sidebar")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "워크스페이스 전환" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "대시보드" })).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Deep Research" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "가져오기" })).toBeVisible();
  });

  test("workspace switcher lists the current workspace", async ({ page }) => {
    await page.goto(`/ko/workspace/${session.wsSlug}/`);
    await page.getByRole("button", { name: "워크스페이스 전환" }).click();
    const menu = page.locator('[data-slot="dropdown-menu-content"]');
    await expect(menu).toBeVisible();
    await expect(menu.getByText("E2E Workspace")).toBeVisible();
  });

  test("shows an empty-state CTA when no project is in scope", async ({
    page,
  }) => {
    await page.goto(`/ko/workspace/${session.wsSlug}/`);
    // The shell dashboard route has no projectId → SidebarEmptyState.
    await expect(
      page.getByTestId("app-shell-sidebar").getByRole("paragraph").filter({
        hasText: "프로젝트를 만들어 시작하세요",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "+ 프로젝트 만들기" }),
    ).toBeVisible();
  });

  test("new folder appears via SSE after POST /api/folders", async ({
    page,
  }) => {
    // Drive the tree by navigating to a project-scoped route (legacy
    // project layout). Phase 2's assembled sidebar on the shell needs the
    // projectId in URL params before it renders <ProjectTree>.
    await page.goto(
      `/ko/workspace/${session.wsSlug}/project/${session.projectId}`,
    );
    const tree = page.getByTestId("project-tree");
    const status = await page.evaluate(async (projectId) => {
      const res = await fetch("/api/folders", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          projectId,
          parentId: null,
          name: "e2e-folder",
        }),
      });
      return res.status;
    }, session.projectId);
    expect(status).toBe(201);
    await expect(tree).toContainText("e2e-folder", { timeout: 5000 });
  });

  test("double-click enters rename and Enter commits (note)", async ({
    page,
  }) => {
    await page.goto(
      `/ko/workspace/${session.wsSlug}/project/${session.projectId}`,
    );
    const tree = page.getByTestId("project-tree");
    const row = tree.getByRole("treeitem").first();
    await row.dblclick();
    const input = row.getByRole("textbox");
    await input.fill("renamed-by-e2e");
    const renameResponse = page.waitForResponse(
      (res) =>
        res.url().includes("/api/notes/") &&
        res.request().method() === "PATCH",
    );
    await input.press("Enter");
    expect((await renameResponse).ok()).toBe(true);
    await expect(row).toContainText("renamed-by-e2e");
  });
});
