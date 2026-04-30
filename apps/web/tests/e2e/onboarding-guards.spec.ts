import { test, expect } from "@playwright/test";
import { applySessionCookie, seedAndSignIn } from "./helpers/seed-session";

test.describe("onboarding guards", () => {
  test("unauthed → /auth/login", async ({ page }) => {
    await page.goto("/ko/onboarding");
    // next-intl strips the `/ko` prefix for the default locale.
    await expect(page).toHaveURL(/\/auth\/login/, { timeout: 10_000 });
  });

  test("authed + no workspace + no invite → auto-provisions and redirects to /workspace/:slug", async ({
    page,
    request,
    context,
  }) => {
    const session = await seedAndSignIn(request, {
      mode: "onboarding-empty",
    });
    await applySessionCookie(context, session);
    await page.goto("/ko/onboarding");
    // Server-side auto-create runs before the shell renders; the manual
    // create form is now reserved for invite-error fallback paths only.
    // `localePrefix: "as-needed"` strips the `/ko` segment for the default
    // locale, so the redirected URL is `/workspace/:slug`.
    await expect(page).toHaveURL(/\/workspace\/[a-z0-9-]+/, {
      timeout: 10_000,
    });
  });

  test("authed + has workspace + no invite → /workspace/:slug", async ({
    page,
    request,
    context,
  }) => {
    const session = await seedAndSignIn(request); // default mode has workspace
    await applySessionCookie(context, session);
    await page.goto("/ko/onboarding");
    await expect(page).toHaveURL(
      new RegExp(`/workspace/${session.wsSlug}`),
      { timeout: 10_000 },
    );
  });
});
