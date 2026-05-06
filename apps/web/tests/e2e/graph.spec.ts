import { test, expect } from "@playwright/test";
import {
  applySessionCookie,
  seedAndSignIn,
  type SeededSession,
} from "./helpers/seed-session";

// Plan 5 Phase 1 — sidebar → graph route + Backlinks panel toggle smoke.
//
// The default seed (POST /api/internal/test-seed) gives us a user +
// workspace + project + Welcome note. It does NOT seed concepts /
// concept_edges / wiki_links — those come from the Compiler agent, which
// is not invoked synchronously. So this spec exercises:
//   1. Sidebar `<ProjectGraphLink/>` entry is reachable when a project
//      is in scope, click navigates to /workspace/<slug>/project/<id>/graph, viewer
//      mounts and shows the empty state (concepts: 0).
//   2. Direct URL → graph route mounts the viewer.
//   3. ⌘⇧B / Ctrl+Shift+B on a note route opens the BacklinksPanel and
//      shows the empty state (no source notes link to the seeded note).
//
// The "graph with at least one node" + "backlinks listing actual sources"
// assertions are deferred to a follow-up that introduces a `plan-5` seed
// mode populating concepts/edges/wiki_links explicitly. See plan §13.

test.describe("Plan 5 Phase 1 — Graph + Backlinks", () => {
  let session: SeededSession;

  test.beforeEach(async ({ context, request }) => {
    session = await seedAndSignIn(request);
    await applySessionCookie(context, session);
  });

  test("sidebar entry navigates to /project/<id>/graph and viewer mounts", async ({
    page,
  }) => {
    // Land on a project page so `useCurrentProjectContext` returns the
    // projectId; otherwise <ProjectGraphLink/> renders nothing.
    await page.goto(
      `/ko/workspace/${session.wsSlug}/project/${session.projectId}`,
    );

    // Sidebar entry — i18n key sidebar.graph.entry / "이 프로젝트 그래프 보기"
    await page
      .getByRole("link", { name: /이 프로젝트 그래프 보기/ })
      .click();

    await expect(page).toHaveURL(
      new RegExp(
        `/workspace/${session.wsSlug}/project/${session.projectId}/graph$`,
      ),
    );
    await expect(page.getByTestId("project-graph-viewer")).toBeVisible();
    // Empty state copy from messages/ko/graph.json viewer.empty.title
    await expect(
      page.getByText(/아직 그래프가 비어 있습니다/),
    ).toBeVisible();
  });

  test("direct URL to /project/<id>/graph mounts the viewer", async ({ page }) => {
    await page.goto(
      `/ko/workspace/${session.wsSlug}/project/${session.projectId}/graph`,
    );
    await expect(page.getByTestId("project-graph-viewer")).toBeVisible();
  });

  test("BacklinksPanel toggles with Cmd+Shift+B on a note route", async ({
    page,
    browserName,
  }) => {
    await page.goto(`/ko/workspace/${session.wsSlug}/note/${session.noteId}`);
    // Mac uses Meta, Win/Linux uses Control. Playwright's Meta also maps
    // correctly on the macOS WebKit channel.
    const cmd = browserName === "webkit" ? "Meta" : "Control";
    await page.keyboard.press(`${cmd}+Shift+KeyB`);

    // Aria label from messages/ko/note.json backlinks.toggleAria
    await expect(
      page.getByRole("complementary", { name: /백링크 패널/ }),
    ).toBeVisible();
    await expect(page.getByText("백링크")).toBeVisible();
    // Empty state copy — Welcome note has no inbound wiki-links.
    await expect(
      page.getByText(/이 노트를 가리키는 다른 노트가 없습니다/),
    ).toBeVisible();
  });
});
