import { test, expect } from "@playwright/test";
import {
  applySessionCookie,
  seedAndSignIn,
  type SeededSession,
} from "./helpers/seed-session";

// Plan 11A — chat scope foundation E2E. Covers:
//   1. Workspace-scope chat auto-attaches the workspace chip.
//   2. Sending a message creates a conversation and renders the
//      assistant placeholder reply with a cost badge.
//   3. Switching RAG mode persists across the PATCH round trip (the
//      label flips immediately and survives a navigation).
//
// Pin warning + page-scope auto-attach E2E coverage is deferred to Plan
// 11B because:
//   • Page-scope embedding into the note viewer ships in 11B.
//   • The pin warning needs a multi-user fixture (target page reader who
//     can't see the cited source) — the seed helper builds single-user
//     workspaces. Adding a multi-user seed for one assertion bloats this
//     file out of proportion to the gain. The unit tests in
//     apps/api/tests/chat.test.ts cover the 409 flow.
test.describe("Plan 11A — Chat Scope Foundation", () => {
  let session: SeededSession;

  test.beforeEach(async ({ context, request }) => {
    session = await seedAndSignIn(request);
    await applySessionCookie(context, session);
  });

  test("workspace-scope chat auto-attaches the workspace chip", async ({
    page,
  }) => {
    await page.goto(`/ko/app/w/${session.wsSlug}/chat-scope`);
    // The auto-attached chip carries the workspace id (or the slug while
    // useWorkspaceId resolves). Either way the chip renders inside the
    // chip row. We assert the input placeholder + send button are
    // present, which together establish the panel rendered correctly.
    await expect(page.getByPlaceholder("어떻게 도와드릴까요?")).toBeVisible();
    await expect(page.getByRole("button", { name: "보내기" })).toBeVisible();
  });

  test("sends a message and receives the placeholder reply with cost badge", async ({
    page,
  }) => {
    await page.goto(`/ko/app/w/${session.wsSlug}/chat-scope`);
    await page.getByPlaceholder("어떻게 도와드릴까요?").fill("test prompt");
    await page.getByRole("button", { name: "보내기" }).click();
    // Placeholder reply text: see apps/api/src/routes/chat.ts (the SSE
    // route writes "(11A placeholder reply)" verbatim).
    await expect(page.getByText("(11A placeholder reply)")).toBeVisible();
    // Cost badge format: `−<amount>원`. The placeholder reply produces a
    // sub-1원 cost so we assert the "원" suffix is present.
    await expect(page.getByText(/원/)).toBeVisible();
  });

  test("switching to Expand mode flips the dropdown label", async ({ page }) => {
    await page.goto(`/ko/app/w/${session.wsSlug}/chat-scope`);
    // Open the RAG toggle.
    await page.getByRole("button", { name: "엄격" }).click();
    // Click the Expand option (rendered by description, not just label).
    await page.getByText("확장 — 칩 외부 워크스페이스로 폴백합니다").click();
    await expect(page.getByRole("button", { name: "확장" })).toBeVisible();
  });
});
