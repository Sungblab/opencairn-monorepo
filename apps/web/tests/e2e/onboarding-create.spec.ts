import { test, expect } from "@playwright/test";
import { applySessionCookie, seedAndSignIn } from "./helpers/seed-session";

test.describe("onboarding create workspace", () => {
  test("fills name, auto-derives slug, submits, lands on /app/w/:slug", async ({
    page,
    request,
    context,
  }) => {
    const session = await seedAndSignIn(request, {
      mode: "onboarding-empty",
    });
    await applySessionCookie(context, session);

    await page.goto("/ko/onboarding");
    await expect(page.getByTestId("ws-name")).toBeVisible();

    await page.getByTestId("ws-name").fill("My Team");
    // Slug should auto-derive to "my-team".
    await expect(page.getByTestId("ws-slug")).toHaveValue("my-team");

    await page.getByTestId("ws-submit").click();
    await expect(page).toHaveURL(/\/ko\/app\/w\/my-team/, {
      timeout: 10_000,
    });
  });
});
