import { test, expect } from "@playwright/test";
import { applySessionCookie, seedAndSignIn } from "./helpers/seed-session";

test.describe("onboarding invite accept", () => {
  test("shows invite card and accepts → lands on invited workspace", async ({
    page,
    request,
    context,
  }) => {
    const session = await seedAndSignIn(request, {
      mode: "onboarding-invite",
    });
    await applySessionCookie(context, session);

    const token = session.inviteToken!;
    const slug = session.inviteWorkspaceSlug!;

    await page.goto(`/ko/onboarding?invite=${token}`);
    await expect(page.getByTestId("invite-accept")).toBeVisible();

    await page.getByTestId("invite-accept").click();
    // next-intl strips the `/ko` prefix for the default locale.
    await expect(page).toHaveURL(new RegExp(`/app/w/${slug}`), {
      timeout: 10_000,
    });
  });

  test("invalid token → falls back to create form with banner", async ({
    page,
    request,
    context,
  }) => {
    const session = await seedAndSignIn(request, {
      mode: "onboarding-empty",
    });
    await applySessionCookie(context, session);

    await page.goto("/ko/onboarding?invite=" + "x".repeat(44));
    await expect(page.getByTestId("ws-name")).toBeVisible();
    await expect(page.getByRole("status")).toContainText(/초대/);
  });
});
