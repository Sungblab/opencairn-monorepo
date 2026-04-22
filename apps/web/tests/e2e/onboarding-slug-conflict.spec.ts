import { test, expect } from "@playwright/test";
import { applySessionCookie, seedAndSignIn } from "./helpers/seed-session";

test.describe("onboarding slug conflict", () => {
  test("409 shows error + suggestions; picking a suggestion submits", async ({
    page,
    request,
    context,
  }) => {
    // First user claims "popular-team".
    const first = await seedAndSignIn(request, { mode: "onboarding-empty" });
    await applySessionCookie(context, first);
    await page.goto("/ko/onboarding");
    await page.getByTestId("ws-name").fill("Popular Team");
    await page.getByTestId("ws-submit").click();
    await expect(page).toHaveURL(/\/app\/w\/popular-team/, {
      timeout: 10_000,
    });

    // Fresh browser context for second user.
    await context.clearCookies();
    const second = await seedAndSignIn(request, { mode: "onboarding-empty" });
    await applySessionCookie(context, second);
    await page.goto("/ko/onboarding");
    await page.getByTestId("ws-name").fill("Popular Team");
    await page.getByTestId("ws-submit").click();

    // Conflict path: alert + suggestion chips.
    await expect(page.getByRole("alert")).toContainText(/이미|taken/i);
    await page.getByText("popular-team-2").click();
    await page.getByTestId("ws-submit").click();
    await expect(page).toHaveURL(/\/app\/w\/popular-team-2/, {
      timeout: 10_000,
    });
  });
});
