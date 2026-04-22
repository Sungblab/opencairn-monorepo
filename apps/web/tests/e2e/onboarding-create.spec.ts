import { test, expect } from "@playwright/test";
import { applySessionCookie, seedAndSignIn } from "./helpers/seed-session";

test.describe("onboarding create workspace", () => {
  test("fills name, submits, lands on /app/w/:auto-generated-slug", async ({
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
    await page.getByTestId("ws-submit").click();
    // Slug derived from ASCII-compatible name → "my-team".
    await expect(page).toHaveURL(/\/ko\/app\/w\/my-team/, {
      timeout: 10_000,
    });
  });

  test("non-ASCII name gets a random slug", async ({
    page,
    request,
    context,
  }) => {
    const session = await seedAndSignIn(request, {
      mode: "onboarding-empty",
    });
    await applySessionCookie(context, session);

    await page.goto("/ko/onboarding");
    await page.getByTestId("ws-name").fill("내 작업공간");
    await page.getByTestId("ws-submit").click();
    // All-Korean name → no derivable ASCII → `w-xxxxxxxx` fallback.
    await expect(page).toHaveURL(/\/ko\/app\/w\/w-[a-f0-9]{8}/, {
      timeout: 10_000,
    });
  });
});
