import { test, expect } from "@playwright/test";
import {
  applySessionCookie,
  seedAndSignIn,
  type SeededSession,
} from "./helpers/seed-session";

// App Shell Phase 1 — verifies the 3-panel shell renders, the two global
// shortcuts toggle their panels, representative workspace routes mount under
// the (shell) group, and the locale root sends authed users to the app-level
// dashboard per proxy.ts.
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
    await page.goto(`/ko/workspace/${session.wsSlug}/settings`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByTestId("app-shell")).toBeVisible();
    await expect(page.getByTestId("app-shell-sidebar")).toBeVisible();
    await expect(page.getByTestId("app-shell-main")).toBeVisible();
    await expect(page.getByTestId("app-shell-agent-panel")).toBeVisible();
    await expect(page.getByTestId("route-ws-settings")).toBeVisible();
  });

  test("Ctrl+\\ toggles sidebar", async ({ page }) => {
    await page.goto(`/ko/workspace/${session.wsSlug}/settings`);
    await expect(page.getByTestId("app-shell-sidebar")).toBeVisible();
    await page.keyboard.press("Control+\\");
    await expect(page.getByTestId("app-shell-sidebar")).not.toBeVisible();
    await page.keyboard.press("Control+\\");
    await expect(page.getByTestId("app-shell-sidebar")).toBeVisible();
  });

  test("Ctrl+J toggles agent panel", async ({ page }) => {
    await page.goto(`/ko/workspace/${session.wsSlug}/settings`);
    await expect(page.getByTestId("app-shell-agent-panel")).toBeVisible();
    await page.keyboard.press("Control+j");
    await expect(
      page.getByTestId("app-shell-agent-panel"),
    ).not.toBeVisible();
  });

  test("workspace routes mount under the shell layout", async ({
    page,
  }) => {
    await page.goto(`/ko/workspace/${session.wsSlug}/settings`);
    await expect(page.getByTestId("route-ws-settings")).toBeVisible();
    await expect(page.getByTestId("app-shell-sidebar")).toBeVisible();

    await page.goto(`/ko/workspace/${session.wsSlug}/research`);
    await expect(
      page.getByRole("heading", { name: "Deep Research" }),
    ).toBeVisible();

    await page.goto(`/ko/workspace/${session.wsSlug}/settings`);
    await expect(page.getByTestId("route-ws-settings")).toBeVisible();

    await page.goto(`/ko/workspace/${session.wsSlug}/settings/members`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByTestId("route-ws-settings")).toBeVisible();
  });

  test("compact viewport renders panels via Sheet overlays", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 800, height: 700 });
    await page.goto(`/ko/workspace/${session.wsSlug}/settings`);
    await expect(page.getByTestId("app-shell-main")).toBeVisible();
    // Sheet content uses Radix dialog semantics — the sidebar/agent regions
    // exist inside the Sheet portal once the dialog opens. Toggle once via
    // shortcut to flip both into a deterministic state, then verify the
    // sidebar can be opened from closed.
    await page.keyboard.press("Control+\\");
    await page.keyboard.press("Control+\\");
    await expect(page.getByTestId("app-shell-sidebar")).toBeVisible();
  });

  test("locale root redirects authed user to dashboard", async ({
    page,
  }) => {
    // The proxy redirects any authed locale root to the app-level dashboard.
    await page.goto("/ko");
    await page.waitForURL(/(?:\/ko)?\/dashboard\/?$/);
  });
});
