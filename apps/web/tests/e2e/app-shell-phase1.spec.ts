import { test, expect } from "@playwright/test";
import {
  applySessionCookie,
  seedAndSignIn,
  type SeededSession,
} from "./helpers/seed-session";

// App Shell Phase 1 — verifies the empty 3-panel shell renders, the two
// global shortcuts toggle their panels, the placeholder routes mount under
// the (shell) group, and the root `/` redirect lands authed users on
// their last-viewed workspace.
//
// The compact-viewport test asserts the actual Phase 1 behavior: the
// panel-store defaults (sidebarOpen: true, agentPanelOpen: true) apply in
// both desktop AND compact modes, so the Sheet overlays start open on a
// narrow viewport. A later phase will likely change this to default-closed
// in compact mode; until then, the test mirrors what ships.
test.describe("App Shell Phase 1", () => {
  let session: SeededSession;

  test.beforeEach(async ({ context, request }) => {
    session = await seedAndSignIn(request);
    await applySessionCookie(context, session);
  });

  test("renders 3-panel shell with placeholders", async ({ page }) => {
    await page.goto(`/ko/app/w/${session.wsSlug}/`);
    await expect(page.getByTestId("app-shell")).toBeVisible();
    await expect(page.getByTestId("app-shell-sidebar")).toBeVisible();
    await expect(page.getByTestId("app-shell-main")).toBeVisible();
    await expect(page.getByTestId("app-shell-agent-panel")).toBeVisible();
    await expect(page.getByTestId("route-dashboard")).toBeVisible();
  });

  test("Ctrl+\\ toggles sidebar", async ({ page }) => {
    await page.goto(`/ko/app/w/${session.wsSlug}/`);
    await expect(page.getByTestId("app-shell-sidebar")).toBeVisible();
    await page.keyboard.press("Control+\\");
    await expect(page.getByTestId("app-shell-sidebar")).not.toBeVisible();
    await page.keyboard.press("Control+\\");
    await expect(page.getByTestId("app-shell-sidebar")).toBeVisible();
  });

  test("Ctrl+J toggles agent panel", async ({ page }) => {
    await page.goto(`/ko/app/w/${session.wsSlug}/`);
    await expect(page.getByTestId("app-shell-agent-panel")).toBeVisible();
    await page.keyboard.press("Control+j");
    await expect(
      page.getByTestId("app-shell-agent-panel"),
    ).not.toBeVisible();
  });

  test("placeholder routes mount under the shell layout", async ({
    page,
  }) => {
    await page.goto(`/ko/app/w/${session.wsSlug}/n/n-abc`);
    await expect(page.getByTestId("route-note")).toBeVisible();
    await expect(page.getByTestId("app-shell-sidebar")).toBeVisible();

    await page.goto(`/ko/app/w/${session.wsSlug}/research`);
    await expect(page.getByTestId("route-research-hub")).toBeVisible();

    await page.goto(`/ko/app/w/${session.wsSlug}/research/r-77`);
    await expect(page.getByTestId("route-research-run")).toBeVisible();

    await page.goto(`/ko/app/w/${session.wsSlug}/settings`);
    await expect(page.getByTestId("route-ws-settings")).toBeVisible();

    await page.goto(`/ko/app/w/${session.wsSlug}/settings/members`);
    await expect(page.getByTestId("route-ws-settings")).toBeVisible();
  });

  test("compact viewport renders panels via Sheet overlays", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 800, height: 700 });
    await page.goto(`/ko/app/w/${session.wsSlug}/`);
    await expect(page.getByTestId("app-shell-main")).toBeVisible();
    // Sheet content uses Radix dialog semantics — the sidebar/agent regions
    // exist inside the Sheet portal once the dialog opens. Toggle once via
    // shortcut to flip both into a deterministic state, then verify the
    // sidebar can be opened from closed.
    await page.keyboard.press("Control+\\");
    await page.keyboard.press("Control+\\");
    await expect(page.getByTestId("app-shell-sidebar")).toBeVisible();
  });

  test("root / redirects authed user to last-viewed workspace", async ({
    page,
  }) => {
    // Prime last-viewed via the API the same way the dashboard would.
    const patchRes = await page.request.patch(
      "http://localhost:4000/api/users/me/last-viewed-workspace",
      { data: { workspaceId: session.workspaceId } },
    );
    expect(patchRes.ok()).toBe(true);

    // next-intl `localePrefix: "as-needed"` strips `/ko` for the default
    // locale, so the URL after redirect is `/app/w/<slug>`. Also tolerate
    // an optional trailing slash since Next sometimes normalizes one.
    await page.goto("/ko");
    await page.waitForURL(
      new RegExp(`(?:/ko)?/app/w/${session.wsSlug}/?$`),
    );
  });
});
