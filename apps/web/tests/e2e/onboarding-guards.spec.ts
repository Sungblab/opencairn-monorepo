import { test, expect } from "@playwright/test";
import { applySessionCookie, seedAndSignIn } from "./helpers/seed-session";

test.describe("onboarding guards", () => {
  test("unauthed → /auth/login", async ({ page }) => {
    await page.goto("/ko/onboarding");
    await expect(page).toHaveURL(/\/ko\/auth\/login/, { timeout: 10_000 });
  });

  test("authed + no workspace → stays on /onboarding", async ({
    page,
    request,
    context,
  }) => {
    const session = await seedAndSignIn(request, {
      mode: "onboarding-empty",
    });
    await applySessionCookie(context, session);
    await page.goto("/ko/onboarding");
    await expect(page).toHaveURL(/\/ko\/onboarding(\?.*)?$/);
    await expect(page.getByTestId("ws-name")).toBeVisible();
  });

  test("authed + has workspace + no invite → /app/w/:slug", async ({
    page,
    request,
    context,
  }) => {
    const session = await seedAndSignIn(request); // default mode has workspace
    await applySessionCookie(context, session);
    await page.goto("/ko/onboarding");
    await expect(page).toHaveURL(
      new RegExp(`/ko/app/w/${session.wsSlug}`),
      { timeout: 10_000 },
    );
  });
});
