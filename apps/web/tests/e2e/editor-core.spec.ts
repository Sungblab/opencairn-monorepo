import { test, expect } from "@playwright/test";
import {
  applySessionCookie,
  seedAndSignIn,
} from "./helpers/seed-session";

// Plan 2A Task 14 — E2E happy path for the editor.
//
//   redirect chain → new note → title+body → "Saved" → reload persists
//
// Depends on the test-only POST /api/internal/test-seed endpoint. Infra
// required: Postgres (docker-compose), API on :4000, web on :3000. The
// Playwright webServer block only spawns web; the API must be running
// separately (`pnpm --filter @opencairn/api dev`).
test.describe("editor core (Plan 2A Task 14)", () => {
  test("create → edit → reload persists", async ({ page, request, context }) => {
    const session = await seedAndSignIn(request);
    await applySessionCookie(context, session);

    // 1. Redirect chain: /ko/app → /ko/app/w/:slug → /ko/app/w/:slug/p/:id.
    //    Start explicit at /ko/ to keep the locale deterministic regardless
    //    of the test browser's Accept-Language header.
    await page.goto(`/ko/app`);
    await expect(page).toHaveURL(
      new RegExp(
        `/(ko/)?app/w/${session.wsSlug}/p/${session.projectId}(/|$)`,
      ),
      { timeout: 15_000 },
    );

    // 2. New note via the sidebar button — seeded "Welcome" note already
    //    exists, so this creates a second one and navigates to it.
    await page.getByTestId("new-note-button").click();
    await expect(page).toHaveURL(/\/notes\/[0-9a-f-]{36}$/, {
      timeout: 10_000,
    });

    // 3. Title first. `useSaveNote` debounces on a single mutation slot, so
    //    successive calls coalesce to the LAST args — we need to let the
    //    title save round-trip to the server before starting the body, or
    //    the body save would overwrite the pending title save and the title
    //    would never be persisted.
    const title = page.getByTestId("note-title");
    await title.fill("Test Note");
    await expect(page.getByTestId("save-status")).toHaveText(
      /저장됨|Saved/,
      { timeout: 5_000 },
    );

    // 4. Body. Ctrl+S forces a synchronous `flush` with both title + editor
    //    value, so we bypass the debounce coalescing caveat above and can
    //    deterministically wait for the resulting network round-trip via
    //    `waitForResponse` rather than scraping the status text (which may
    //    still read "저장됨" from the title save, making a text-only wait
    //    falsely green).
    const body = page.getByTestId("note-body");
    await body.click();
    await page.keyboard.type("Hello world");
    const patchPromise = page.waitForResponse(
      (r) =>
        r.url().includes(`/api/notes/${session.noteId}`) === false &&
        r.url().includes("/api/notes/") &&
        r.request().method() === "PATCH" &&
        r.ok(),
      { timeout: 5_000 },
    );
    await page.keyboard.press("Control+s");
    await patchPromise;
    await expect(page.getByTestId("save-status")).toHaveText(
      /저장됨|Saved/,
      { timeout: 3_000 },
    );

    // 5. Reload — content must still be there.
    await page.reload();
    await expect(page.getByTestId("note-title")).toHaveValue("Test Note", {
      timeout: 10_000,
    });
    await expect(page.getByTestId("note-body")).toContainText("Hello world");
  });

  // Plan 2A Task 16 — wiki-link combobox insertion happy path. The test-seed
  // endpoint ships a "Welcome" note in the same project, so typing "Wel" is
  // enough to surface a result we can click.
  test("wiki-link combobox inserts link", async ({
    page,
    request,
    context,
  }) => {
    const session = await seedAndSignIn(request);
    await applySessionCookie(context, session);

    await page.goto("/ko/app");
    await expect(page).toHaveURL(
      new RegExp(
        `/(ko/)?app/w/${session.wsSlug}/p/${session.projectId}(/|$)`,
      ),
      { timeout: 15_000 },
    );

    // Create a fresh note so we can write into it without racing the seed
    // note's initial hydration.
    await page.getByTestId("new-note-button").click();
    await expect(page).toHaveURL(/\/notes\/[0-9a-f-]{36}$/, {
      timeout: 10_000,
    });

    await page.getByTestId("note-body").click();
    await page.keyboard.type("See: ");
    await page.keyboard.press("Control+k");

    const combobox = page.getByTestId("wikilink-combobox");
    await expect(combobox).toBeVisible();
    await combobox.locator("input").fill("Wel");
    await page.locator('[data-testid^="wikilink-result-"]').first().click();

    await expect(
      page.getByTestId("note-body").locator("a[data-target-id]").first(),
    ).toBeVisible();
  });
});
