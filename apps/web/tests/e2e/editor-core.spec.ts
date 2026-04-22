import { test, expect } from "@playwright/test";
import {
  applySessionCookie,
  seedAndSignIn,
} from "./helpers/seed-session";

// Plan 2A Task 14 (updated for Plan 2B Task 16) — E2E happy path for the
// editor. Content now persists via Yjs + Hocuspocus rather than PATCH, so the
// test verifies title-only REST saves and client-side input/UI wiring.
// Reload-persistence for *content* is covered by Plan 2B integration tests
// (Task 20) which exercise the Hocuspocus onStoreDocument path.
//
// Depends on the test-only POST /api/internal/test-seed endpoint. Infra
// required: Postgres (docker-compose), API on :4000, web on :3000. The
// Playwright webServer block only spawns web; the API must be running
// separately (`pnpm --filter @opencairn/api dev`). Hocuspocus may be down
// for these tests — the editor still mounts, the WS just never connects.
test.describe("editor core (Plan 2A Task 14)", () => {
  test("create → title save → reload persists title", async ({ page, request, context }) => {
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

    // 3. Title save — debounced PATCH /notes/:id { title }. The save pill
    //    reflects the title-only path (content no longer flows through PATCH
    //    under Plan 2B — it's Yjs-canonical).
    const title = page.getByTestId("note-title");
    await title.fill("Test Note");
    await expect(page.getByTestId("save-status")).toHaveText(
      /저장됨|Saved/,
      { timeout: 5_000 },
    );

    // 4. Body input still works even without a live Hocuspocus (the editor
    //    is writable against the local Y.Doc; without a server the doc just
    //    doesn't sync). We only check that keystrokes land in the DOM so the
    //    toolbar/slash/wiki-link interactions downstream still have a target.
    const body = page.getByTestId("note-body");
    await body.click();
    await page.keyboard.type("Hello world");
    await expect(body).toContainText("Hello world");

    // 5. Cmd/Ctrl+S flushes the pending title save. It must NOT send content.
    const patchPromise = page.waitForResponse(
      (r) =>
        r.url().includes("/api/notes/") &&
        r.request().method() === "PATCH" &&
        r.ok(),
      { timeout: 5_000 },
    );
    await page.keyboard.press("Control+s");
    const patchRes = await patchPromise;
    const sentBody = patchRes.request().postDataJSON() as Record<string, unknown>;
    expect(sentBody).toHaveProperty("title");
    expect(sentBody).not.toHaveProperty("content");

    // 6. Reload — title must survive (it went through PATCH). Body state is
    //    out of scope here; Yjs-round-trip lives in Plan 2B integration tests.
    await page.reload();
    await expect(page.getByTestId("note-title")).toHaveValue("Test Note", {
      timeout: 10_000,
    });
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

  // Plan 2A Task 17 — slash command menu. Typing `/` pops a portal menu;
  // picking H1 converts the current line and typed text lands inside an <h1>.
  test("slash menu converts line to H1", async ({
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

    await page.getByTestId("new-note-button").click();
    await expect(page).toHaveURL(/\/notes\/[0-9a-f-]{36}$/, {
      timeout: 10_000,
    });

    await page.getByTestId("note-body").click();
    await page.keyboard.press("/");
    await expect(page.getByTestId("slash-menu")).toBeVisible();
    await page.getByTestId("slash-cmd-h1").click();
    await page.keyboard.type("My heading");
    await expect(
      page.getByTestId("note-body").locator("h1").first(),
    ).toContainText("My heading");
  });
});
