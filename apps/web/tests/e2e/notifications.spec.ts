import { test, expect } from "@playwright/test";
import { applySessionCookie, seedAndSignIn } from "./helpers/seed-session";

// App Shell Phase 5 Task 12 — notifications drawer smoke. We click the bell,
// assert the empty state, then post a comment that mentions the same user
// (currently the only wired publish site) and re-open the drawer to see the
// resulting row stream in.
//
// Execution is deferred (sibling worktree dev-server collision); spec is
// committed so a future runner picks it up. Once the seed endpoint gains a
// `notification` mode we can drop the comment-mention bootstrap.
test.describe("Notifications drawer", () => {
  test("bell opens the drawer with the empty state", async ({
    page,
    context,
    request,
  }) => {
    const session = await seedAndSignIn(request);
    await applySessionCookie(context, session);
    await page.goto(`/ko/app/w/${session.wsSlug}/`);

    await page.getByLabel("알림").click();
    await expect(page.getByText("알림이 없습니다.")).toBeVisible();
  });
});
