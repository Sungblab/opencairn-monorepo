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
      page.getByRole("button", { name: "프로젝트 전환" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "홈" })).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Deep Research" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "온톨로지 아틀라스" })).toBeVisible();
    await expect(page.getByRole("link", { name: "휴지통" })).toBeVisible();
    await expect(page.getByRole("link", { name: "피드백" })).toBeVisible();
    await expect(page.getByRole("link", { name: "업데이트" })).toBeVisible();
  });

  test("project switcher lists the current project", async ({ page }) => {
    await page.goto(`/ko/workspace/${session.wsSlug}/`);
    await page.getByRole("button", { name: "프로젝트 전환" }).click();
    const menu = page.getByRole("listbox", { name: "프로젝트 전환" });
    await expect(menu).toBeVisible();
    await expect(menu.getByText("E2E Mock Project")).toBeVisible();
  });

  test("opens the current project by default when a project exists", async ({
    page,
  }) => {
    await page.goto(`/ko/workspace/${session.wsSlug}/`);
    await expect(page.getByTestId("project-tree")).toBeVisible();
    await expect(
      page.getByTestId("project-tree").getByText("E2E Mock Note"),
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

  test("row action menu exposes rename for notes", async ({
    page,
  }) => {
    await page.goto(
      `/ko/workspace/${session.wsSlug}/project/${session.projectId}`,
    );
    const tree = page.getByTestId("project-tree");
    const row = tree.getByRole("treeitem", { name: "E2E Mock Note" }).last();
    await row.hover();
    await row.getByRole("button", { name: "파일 작업" }).click();
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await expect(menu.getByText("이름 바꾸기")).toBeVisible();
  });
});
