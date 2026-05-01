import { test, expect } from "@playwright/test";
import { applySessionCookie, seedAndSignIn } from "./helpers/seed-session";

// App Shell Phase 5 Task 12 — palette smoke. Verifies the keyboard-driven
// open + the action-registry-driven navigation. Spec authored alongside
// implementation per Plan; execution is deferred (sibling worktree dev-server
// collision — same convention as Phase 4 agent-panel.spec).
test.describe("Command Palette", () => {
  test("opens with Ctrl+K and routes to dashboard via action", async ({
    page,
    context,
    request,
  }) => {
    const session = await seedAndSignIn(request);
    await applySessionCookie(context, session);
    await page.goto(`/ko/workspace/${session.wsSlug}/research`);

    // Open the palette
    await page.keyboard.press("Control+k");
    await expect(page.getByPlaceholder("무엇을 찾고 있나요?")).toBeVisible();

    // Type a substring that matches the dashboard action label
    await page.getByPlaceholder("무엇을 찾고 있나요?").fill("대시보드");
    // cmdk auto-selects the first match; Enter runs it.
    await page.keyboard.press("Enter");

    // We landed on /ko/workspace/<slug>/ (dashboard).
    await page.waitForURL(
      new RegExp(`/ko/workspace/${session.wsSlug}/?$`),
    );
    await expect(page.getByTestId("route-dashboard")).toBeVisible();
  });
});
