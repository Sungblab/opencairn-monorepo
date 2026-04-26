import { test, expect } from "@playwright/test";
import {
  applySessionCookie,
  seedAndSignIn,
  type SeededSession,
} from "./helpers/seed-session";

// Phase E smoke for /settings/ai BYOK key CRUD. The API is real (no
// fetch interceptor) — the seed helper signs the user in, then we
// exercise the live PUT/GET/DELETE flow via the actual UI.
//
// FEATURE_DEEP_RESEARCH does NOT need to be set for this spec; the
// BYOK page is reachable independently.
test.describe("Settings AI BYOK", () => {
  let session: SeededSession;

  test.beforeEach(async ({ context, request }) => {
    session = await seedAndSignIn(request);
    await applySessionCookie(context, session);
  });

  test("register → masked display → replace → delete", async ({ page }) => {
    await page.goto("/ko/app/settings/ai");
    await expect(page.getByRole("heading", { name: "AI 설정" })).toBeVisible();

    // Empty state — input visible.
    const input = page.getByPlaceholder("AIza…");
    await expect(input).toBeVisible();

    // Register.
    const firstKey = "AIzaSyTestPhaseE2EFirstRegistration1abcd";
    await input.fill(firstKey);
    await page.getByRole("button", { name: "저장" }).click();

    // Registered state.
    await expect(page.getByText("abcd")).toBeVisible();
    await expect(page.getByRole("button", { name: "교체" })).toBeVisible();
    await expect(page.getByRole("button", { name: "삭제" })).toBeVisible();

    // Replace.
    await page.getByRole("button", { name: "교체" }).click();
    const input2 = page.getByPlaceholder("AIza…");
    await expect(input2).toBeVisible();
    const secondKey = "AIzaSyTestPhaseE2ESecondRoundRegistwxyz";
    await input2.fill(secondKey);
    await page.getByRole("button", { name: "저장" }).click();
    await expect(page.getByText("wxyz")).toBeVisible();

    // Delete (confirm).
    await page.getByRole("button", { name: "삭제" }).click();
    await expect(page.getByText("API 키를 삭제할까요?")).toBeVisible();
    // The dialog has its own "삭제" button — last() picks it over the page button.
    await page.getByRole("button", { name: "삭제" }).last().click();

    // Back to empty state.
    await expect(page.getByPlaceholder("AIza…")).toBeVisible();
  });
});
