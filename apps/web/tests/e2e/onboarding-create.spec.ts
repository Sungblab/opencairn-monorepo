import { test, expect } from "@playwright/test";
import { applySessionCookie, seedAndSignIn } from "./helpers/seed-session";

test.describe("onboarding auto-provision", () => {
  test("authed + no workspace + no invite → /onboarding auto-creates and redirects to /app/w/:slug", async ({
    page,
    request,
    context,
  }) => {
    const session = await seedAndSignIn(request, {
      mode: "onboarding-empty",
    });
    await applySessionCookie(context, session);

    await page.goto("/ko/onboarding");
    // Server-side auto-provision derives a personal workspace from the user's
    // name. Slug is derived from the (possibly-Korean) default name and falls
    // back to `w-{random}` when no ASCII letters survive — so accept either.
    // next-intl is configured with `localePrefix: "as-needed"` and `ko` as
    // the default, so the redirected URL has no `/ko` prefix.
    await expect(page).toHaveURL(/\/app\/w\/[a-z0-9-]+/, {
      timeout: 10_000,
    });
  });
});
