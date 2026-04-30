import { test, expect } from "@playwright/test";
import {
  applySessionCookie,
  seedAndSignIn,
  type SeededSession,
} from "./helpers/seed-session";

// Plan 5 Phase 2 — view switcher + AI dialog smoke.
//
// The default seed (POST /api/internal/test-seed) gives us a user +
// workspace + project + Welcome note. It does NOT seed concepts /
// concept_edges / wiki_links — those come from the Compiler agent, which
// is not invoked synchronously. So this spec exercises:
//   1. The 5-button view switcher renders and clicking each button
//      replaces `?view=` while preserving other params.
//   2. Direct URL `?view=cards` (and other modes) mounts the right view
//      and shows the per-view empty state.
//   3. 1-5 keyboard shortcuts toggle `?view=` from the graph route.
//   4. Clicking the "AI로 만들기" trigger opens the VisualizeDialog modal.
//
// The AI dialog's SSE → ViewSpec → URL navigate flow is deferred to a
// follow-up that introduces a `plan-5` seed mode populating concepts +
// a mocked Vis Agent fixture (or a real worker run). See plan §13 +
// Task 30. Running the dialog against the real Gemini-backed Vis Agent
// from a CI smoke test is out of scope.

test.describe("Plan 5 Phase 2 — view switcher", () => {
  let session: SeededSession;

  test.beforeEach(async ({ context, request }) => {
    session = await seedAndSignIn(request);
    await applySessionCookie(context, session);
  });

  test("renders all 5 view buttons + AI trigger", async ({ page }) => {
    await page.goto(
      `/ko/workspace/${session.wsSlug}/project/${session.projectId}/graph`,
    );
    await expect(page.getByTestId("project-graph-viewer")).toBeVisible();
    // i18n keys come from messages/ko/graph.json views.{graph,mindmap,...}.
    for (const label of ["그래프", "마인드맵", "카드", "타임라인", "보드"]) {
      await expect(
        page.getByRole("button", { name: label }).first(),
      ).toBeVisible();
    }
    // graph.ai.trigger
    await expect(
      page.getByRole("button", { name: /AI로 만들기/ }),
    ).toBeVisible();
  });

  test("clicking a view button updates ?view= in the URL", async ({
    page,
  }) => {
    await page.goto(
      `/ko/workspace/${session.wsSlug}/project/${session.projectId}/graph`,
    );
    // Cards view doesn't need a root, so it renders the noConcepts empty
    // state immediately for an empty seed. We use it as the click target.
    await page.getByRole("button", { name: "카드" }).first().click();
    await expect(page).toHaveURL(/[?&]view=cards\b/);
  });

  test("?view=cards loads directly and renders the cards empty state", async ({
    page,
  }) => {
    await page.goto(
      `/ko/workspace/${session.wsSlug}/project/${session.projectId}/graph?view=cards`,
    );
    await expect(page.getByTestId("project-graph-viewer")).toBeVisible();
    // graph.views.noConcepts copy
    await expect(
      page.getByText(/이 프로젝트에는 아직 개념이 없습니다/),
    ).toBeVisible();
  });

  test("?view=timeline loads directly and shows the timeline empty state", async ({
    page,
  }) => {
    await page.goto(
      `/ko/workspace/${session.wsSlug}/project/${session.projectId}/graph?view=timeline`,
    );
    await expect(page.getByTestId("project-graph-viewer")).toBeVisible();
    await expect(
      page.getByText(/이 프로젝트에는 아직 개념이 없습니다/),
    ).toBeVisible();
  });

  test("pressing 3 swaps to ?view=cards", async ({ page }) => {
    await page.goto(
      `/ko/workspace/${session.wsSlug}/project/${session.projectId}/graph`,
    );
    await expect(page.getByTestId("project-graph-viewer")).toBeVisible();
    // Click the body so the keydown listener (window-level) fires; Playwright
    // dispatches keys to the focused element by default.
    await page.locator("body").click();
    await page.keyboard.press("3");
    await expect(page).toHaveURL(/[?&]view=cards\b/);
  });

  test("AI trigger opens the VisualizeDialog modal", async ({ page }) => {
    await page.goto(
      `/ko/workspace/${session.wsSlug}/project/${session.projectId}/graph`,
    );
    await page.getByRole("button", { name: /AI로 만들기/ }).click();
    // graph.ai.dialogTitle
    await expect(
      page.getByRole("dialog", { name: /AI로 뷰 만들기/ }),
    ).toBeVisible();
    // graph.ai.promptPlaceholder — verifies prompt textarea mounted.
    await expect(
      page.getByPlaceholder(/트랜스포머 주제로 마인드맵/),
    ).toBeVisible();
  });

  test.skip(
    "AI dialog SSE → ViewSpec → URL navigate flow",
    // Requires a `plan-5` seed mode that populates concepts + a mocked
    // Vis Agent fixture. Plan 5 Phase 2 follow-up (Task 30).
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    async () => {},
  );
});
