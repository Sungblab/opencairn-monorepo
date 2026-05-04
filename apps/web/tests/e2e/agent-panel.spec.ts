import { test, expect } from "@playwright/test";
import { type SeededSession } from "./helpers/seed-session";
import { seedFullStackSession } from "./helpers/full-stack";

// App Shell Phase 4 Task 12 — Agent Panel happy paths.
//
// These smoke tests assert deterministic shell behavior and the SSE route
// opening, not literal LLM text.
//
// All visible strings are pulled from the i18n keys in
// apps/web/messages/ko/agent-panel.json — keep this file in sync if the
// copy ever changes.
test.describe("App Shell Phase 4 — Agent Panel", () => {
  test.describe.configure({ timeout: 120_000 });

  let session: SeededSession;

  test.beforeEach(async ({ context, request }) => {
    session = await seedFullStackSession(request, context);
  });

  test("empty state shows on first visit and starts a thread", async ({
    page,
  }) => {
    await page.goto(`/ko/workspace/${session.wsSlug}/`);
    await expect(page.getByTestId("app-shell-agent-panel")).toBeVisible();
    // empty_state.start_cta — both the CTA text and the role=button label.
    await expect(
      page.getByRole("button", { name: "첫 대화 시작" }),
    ).toBeVisible();
    const startButton = page.getByRole("button", { name: "첫 대화 시작" });
    await expect(startButton).toBeEnabled({ timeout: 90_000 });
    await startButton.click();
    // composer.placeholder — once a thread is active the textarea is no
    // longer disabled (Composer's `disabled` flips off when activeThreadId
    // is set).
    await expect(page.getByPlaceholder("메시지를 입력하세요...")).toBeEnabled();
  });

  test("sends a message through the full-stack thread SSE route", async ({
    page,
  }) => {
    await page.goto(`/ko/workspace/${session.wsSlug}/`);
    await page.getByRole("button", { name: "첫 대화 시작" }).click();

    const ta = page.getByPlaceholder("메시지를 입력하세요...");
    await expect(ta).toBeEnabled();

    const responsePromise = page.waitForResponse(
      (res) =>
        res.url().includes("/api/threads/") &&
        res.url().endsWith("/messages") &&
        res.request().method() === "POST",
    );
    await ta.fill("e2e agent smoke");
    await ta.press("Enter");

    const response = await responsePromise;
    expect(response.status()).toBe(200);
    await expect(ta).toHaveValue("");
  });

  test("thumbs-down exposes reason chips", async ({ page }) => {
    await page.goto(`/ko/workspace/${session.wsSlug}/`);
    await page.getByRole("button", { name: "첫 대화 시작" }).click();
    const ta = page.getByPlaceholder("메시지를 입력하세요...");
    await ta.fill("hi");
    await ta.press("Enter");
    await expect(page.getByText("Mock agent response.")).toBeVisible();

    // bubble.actions.thumbs_down_aria — flipping reasonOpen renders the
    // four feedback chips inline.
    await page.getByRole("button", { name: "싫어요" }).click();
    // bubble.feedback_reasons.incorrect
    await expect(page.getByRole("button", { name: "부정확" })).toBeVisible();
  });

  test("new thread via + preserves previous thread in list", async ({
    page,
  }) => {
    await page.goto(`/ko/workspace/${session.wsSlug}/`);
    await page.getByRole("button", { name: "첫 대화 시작" }).click();
    const ta = page.getByPlaceholder("메시지를 입력하세요...");
    await ta.fill("first thread message");
    await ta.press("Enter");
    await expect(page.getByText("Mock agent response.")).toBeVisible();

    // header.new_thread_aria — spawns a second thread and activates it.
    await page.getByRole("button", { name: "새 대화" }).click();
    // header.thread_list_aria — open the dropdown to inspect history.
    await page.getByRole("button", { name: "대화 목록" }).click();
    // The previous thread was never named so it falls back to
    // thread_list.untitled. We assert >= 2 untitled entries to tolerate
    // either-or thread ordering and the fact that both threads show the
    // placeholder title.
    await expect(
      page.getByRole("menuitem").filter({ hasText: "(제목 없음)" }),
    ).toHaveCount(2);
  });
});
