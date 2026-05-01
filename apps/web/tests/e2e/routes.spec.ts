import { test, expect } from "@playwright/test";
import { applySessionCookie, seedAndSignIn } from "./helpers/seed-session";

// App Shell Phase 5 Task 12 — every URL in spec §3.1 + §7 renders its real
// view (no leftover Phase 1 placeholders). We rely on `data-testid` attrs
// added by each view rather than copy strings so the assertion survives
// i18n changes.
//
// Execution deferred (Phase 4 convention).
test.describe("Phase 5 routes", () => {
  const SHELL_ROUTES = [
    { path: "/", testId: "route-dashboard" },
    { path: "/research", heading: "Deep Research" },
    { path: "/settings", testId: "route-ws-settings" },
  ] as const;

  test.describe("inside (shell) group", () => {
    for (const r of SHELL_ROUTES) {
      test(`renders ${r.path}`, async ({ page, context, request }) => {
        const session = await seedAndSignIn(request);
        await applySessionCookie(context, session);
        await page.goto(`/ko/workspace/${session.wsSlug}${r.path}`);
        if ("testId" in r) {
          await expect(page.getByTestId(r.testId)).toBeVisible();
        } else {
          await expect(page.getByRole("heading", { name: r.heading })).toBeVisible();
        }
      });
    }

    test("renders /project/[projectId] inside (shell)", async ({
      page,
      context,
      request,
    }) => {
      const session = await seedAndSignIn(request);
      await applySessionCookie(context, session);
      await page.goto(
        `/ko/workspace/${session.wsSlug}/project/${session.projectId}`,
      );
      await expect(page.getByTestId("route-project")).toBeVisible();
    });
  });

  test("account settings profile renders outside AppShell", async ({
    page,
    context,
    request,
  }) => {
    const session = await seedAndSignIn(request);
    await applySessionCookie(context, session);
    await page.goto(`/ko/settings/profile`);
    // /settings/* uses AccountShell — assert by the form heading translation
    // key we render in ProfileView.
    await expect(page.getByRole("heading", { name: "프로필" })).toBeVisible();
  });
});
