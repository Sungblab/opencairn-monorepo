import { test, expect } from "@playwright/test";
import {
  applySessionCookie,
  seedAndSignIn,
  type SeededSession,
} from "./helpers/seed-session";

// Smoke test for Deep Research Phase D. Mocks every /api/research/* endpoint
// so the flow runs deterministically without hitting Google. Mirrors the
// auth bootstrap pattern used by other (shell)-route specs.
//
// Phase D ships this spec but does NOT gate the PR on a green run. The dev
// server must boot with FEATURE_DEEP_RESEARCH=true for the page to mount;
// without that env, the route 404s by design (apps/api/src/routes/research.ts
// :52 + apps/web/src/lib/feature-flags.ts). Phase E owns the full E2E green
// matrix including the env wiring — this file is the contract.
test.describe("Deep Research smoke", () => {
  test.describe.configure({ timeout: 60_000 });

  let session: SeededSession;

  test.beforeEach(async ({ context, request }) => {
    session = await seedAndSignIn(request);
    await applySessionCookie(context, session);
  });

  test.skip(
    process.env.FEATURE_DEEP_RESEARCH?.toLowerCase() !== "true",
    "FEATURE_DEEP_RESEARCH not set on dev server — Phase E will run this in CI",
  );

  test("submit topic → plan → approve → completed redirect", async ({
    page,
  }) => {
    await page.goto(`/ko/workspace/${session.wsSlug}/research`);
    await expect(page.getByText("Deep Research")).toBeVisible();
    await page.getByRole("button", { name: /새 리서치 시작/ }).click();
    await expect(page.getByRole("dialog", { name: /새 리서치/ })).toBeVisible();
    await page.getByTestId("research-topic").fill("Smoke topic");
    // Project select — first non-empty option (the seeded fixture project).
    await page.locator("select").first().selectOption(session.projectId!);
    const submitButton = page.getByRole("button", { name: /시작하기/ });
    await expect(submitButton).toBeEnabled();
    await submitButton.click();
    await page.waitForURL(/\/research\/r-smoke/);

    // Plan review screen.
    await expect(page.getByText(/조사 계획 검토/)).toBeVisible();
    await expect(page.getByText(/1\) Step/)).toBeVisible();

    await page.getByRole("button", { name: /승인하고 시작/ }).click();

    // After completion, we redirect to /note/n-smoke. Wait for that.
    await page.waitForURL(/\/note\/n-smoke/);
    await expect(page.getByText("Smoke topic")).toBeVisible();
  });
});
