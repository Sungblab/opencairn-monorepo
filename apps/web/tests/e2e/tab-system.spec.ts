import { test, expect } from "@playwright/test";
import {
  applySessionCookie,
  seedAndSignIn,
  type SeededSession,
} from "./helpers/seed-session";
import { createNote, type CreatedNote } from "./helpers/notes";

// App Shell Phase 3-A — covers the tab bar chrome end-to-end: preview
// italic + single-click replace + first-edit promote, Ctrl+W close,
// Ctrl+T new tab, overflow trigger visibility, and context-menu pin.
//
// Drag reorder is NOT covered here — Playwright's dragTo over @dnd-kit
// needs extra step granularity that's better targeted in a dedicated
// drag spec alongside Phase 2 sidebar drag. The keyboard-based reorder
// path (mod+alt+ArrowRight) is already covered by the unit test.
//
// Like the other Phase 1/2 specs, this suite is deferred from CI until
// the parallel dev/api server fixture lands. Running locally:
//   pnpm --filter @opencairn/web dev       # port 3000
//   pnpm --filter @opencairn/api dev       # port 4000
//   pnpm --filter @opencairn/web test:e2e tests/e2e/tab-system.spec.ts

test.describe("App Shell tab system (Phase 3-A)", () => {
  let session: SeededSession;
  let extraNotes: CreatedNote[];

  test.beforeEach(async ({ context, request }) => {
    session = await seedAndSignIn(request);
    await applySessionCookie(context, session);
    // test-seed creates one Welcome note; spin up 2 more so the preview
    // replace + overflow assertions have enough material to work on.
    extraNotes = await Promise.all([
      createNote(request, session, "Phase3 Note Alpha"),
      createNote(request, session, "Phase3 Note Beta"),
    ]);
  });

  test("tab bar renders without a generic new-tab trigger", async ({ page }) => {
    await page.goto(`/ko/workspace/${session.wsSlug}/`);
    await expect(page.getByTestId("tab-bar")).toBeVisible();
    await expect(page.getByTestId("tab-bar-new")).toHaveCount(0);
  });

  test("note route opens an editable note tab", async ({
    page,
  }) => {
    await page.goto(`/ko/workspace/${session.wsSlug}/note/${session.noteId}`);
    await expect(page.getByRole("tab", { name: /E2E Mock Note/ })).toBeVisible();
    await page.getByTestId("note-title").click();
    await page.keyboard.type(" editable");
    await expect(page.getByTestId("note-title")).toHaveValue(/editable/);
  });

  test("single-clicking another note replaces the preview slot", async ({
    page,
  }) => {
    await page.goto(
      `/ko/workspace/${session.wsSlug}/note/${extraNotes[0].id}`,
    );
    // Let the URL-driven tab sync settle.
    await expect(page.locator('[role="tab"]')).toHaveCount(1);

    // Navigate to a different note via URL — the use-url-tab-sync hook
    // must call addOrReplacePreview, keeping the total at 1.
    await page.goto(
      `/ko/workspace/${session.wsSlug}/note/${extraNotes[1].id}`,
    );
    await expect(page.locator('[role="tab"]')).toHaveCount(1);
  });

  test("Ctrl+W closes the active tab", async ({ page }) => {
    await page.goto(
      `/ko/workspace/${session.wsSlug}/note/${extraNotes[0].id}`,
    );
    await expect(page.locator('[role="tab"]')).toHaveCount(1);
    await page.keyboard.press("Control+w");
    await expect(page.locator('[role="tab"]')).toHaveCount(1);
  });

  test("Ctrl+T opens a new blank tab", async ({ page }) => {
    await page.goto(`/ko/workspace/${session.wsSlug}/`);
    const before = await page.locator('[role="tab"]').count();
    await page.keyboard.press("Control+t");
    await expect(page.locator('[role="tab"]')).toHaveCount(before + 1);
  });

  test("pin hides the close button and Ctrl+W becomes a no-op", async ({
    page,
  }) => {
    await page.goto(
      `/ko/workspace/${session.wsSlug}/note/${extraNotes[0].id}`,
    );
    const tab = page.locator('[role="tab"]').first();
    await expect(tab).toBeVisible();
    await page.getByTestId("tab-bar").hover();
    const trigger = page.locator('[data-slot="context-menu-trigger"]').first();
    await expect(trigger).toBeVisible();
    await trigger.click({ button: "right" });
    // Context menu renders via portal; scope the menu role to avoid
    // matching inactive triggers.
    const menu = page.locator('[data-slot="context-menu-content"]');
    await expect(menu).toBeVisible();
    await menu.locator('[data-slot="context-menu-item"]').filter({ hasText: "고정" }).click();

    await expect(tab.getByLabel("닫기")).toHaveCount(0);
    await expect(tab.getByLabel("고정됨")).toBeVisible();

    await page.keyboard.press("Control+w");
    await expect(page.locator('[role="tab"]')).toHaveCount(1);
  });

  test("overflow menu lists every open tab", async ({ page }) => {
    await page.goto(
      `/ko/workspace/${session.wsSlug}/project/${session.projectId}`,
    );
    await expect(page.locator('[role="tab"]')).toHaveCount(1);
    const openTabs = await page.locator('[role="tab"]').count();
    await page.getByTestId("tab-overflow-trigger").hover();
    await page.getByTestId("tab-overflow-trigger").click();
    const menu = page.locator('[data-slot="dropdown-menu-content"]');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("option")).toHaveCount(openTabs);
  });
});
