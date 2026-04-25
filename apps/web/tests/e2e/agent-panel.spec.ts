import { test, expect } from "@playwright/test";
import {
  applySessionCookie,
  seedAndSignIn,
  type SeededSession,
} from "./helpers/seed-session";

// App Shell Phase 4 Task 12 — Agent Panel happy paths.
//
// Covers: empty-state CTA bootstraps a thread, send → SSE stub stream
// produces a deterministic agent reply, thumbs-down reveals reason chips,
// and the "+" header button creates a fresh thread without losing the
// previous one. The stub `runAgent` in apps/api/src/lib/agent-pipeline.ts
// echoes the user input verbatim ("(stub agent response to: <input>)") so
// the assertions don't depend on a live LLM.
//
// All visible strings are pulled from the i18n keys in
// apps/web/messages/ko/agent-panel.json — keep this file in sync if the
// copy ever changes.
test.describe("App Shell Phase 4 — Agent Panel", () => {
  let session: SeededSession;

  test.beforeEach(async ({ context, request }) => {
    session = await seedAndSignIn(request);
    await applySessionCookie(context, session);
  });

  test("empty state shows on first visit and starts a thread", async ({
    page,
  }) => {
    await page.goto(`/ko/app/w/${session.wsSlug}/`);
    await expect(page.getByTestId("app-shell-agent-panel")).toBeVisible();
    // empty_state.start_cta — both the CTA text and the role=button label.
    await expect(
      page.getByRole("button", { name: "첫 대화 시작" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "첫 대화 시작" }).click();
    // composer.placeholder — once a thread is active the textarea is no
    // longer disabled (Composer's `disabled` flips off when activeThreadId
    // is set).
    await expect(
      page.getByPlaceholder("메시지를 입력하세요..."),
    ).toBeEnabled();
  });

  test("sends a message and receives streamed stub response", async ({
    page,
  }) => {
    await page.goto(`/ko/app/w/${session.wsSlug}/`);
    await page.getByRole("button", { name: "첫 대화 시작" }).click();

    const ta = page.getByPlaceholder("메시지를 입력하세요...");
    await ta.fill("hello");
    await ta.press("Enter");

    // Stub stream is ~50 chars at 4ms/char (~200ms) plus persistence; 5s
    // is generous for CI.
    await expect(
      page.getByText(/stub agent response to: hello/),
    ).toBeVisible({ timeout: 5000 });
  });

  test("thumbs-down exposes reason chips", async ({ page }) => {
    await page.goto(`/ko/app/w/${session.wsSlug}/`);
    await page.getByRole("button", { name: "첫 대화 시작" }).click();
    const ta = page.getByPlaceholder("메시지를 입력하세요...");
    await ta.fill("hi");
    await ta.press("Enter");
    // Wait for the agent reply to render so MessageActions is mounted.
    await expect(
      page.getByText(/stub agent response to: hi/),
    ).toBeVisible({ timeout: 5000 });

    // bubble.actions.thumbs_down_aria — flipping reasonOpen renders the
    // four feedback chips inline.
    await page.getByRole("button", { name: "싫어요" }).click();
    // bubble.feedback_reasons.incorrect
    await expect(
      page.getByRole("button", { name: "부정확" }),
    ).toBeVisible();
  });

  test("new thread via + preserves previous thread in list", async ({
    page,
  }) => {
    await page.goto(`/ko/app/w/${session.wsSlug}/`);
    await page.getByRole("button", { name: "첫 대화 시작" }).click();
    const ta = page.getByPlaceholder("메시지를 입력하세요...");
    await ta.fill("first thread message");
    await ta.press("Enter");
    await expect(
      page.getByText(/stub agent response to: first thread message/),
    ).toBeVisible({ timeout: 5000 });

    // header.new_thread_aria — spawns a second thread and activates it.
    await page.getByRole("button", { name: "새 대화" }).click();
    // header.thread_list_aria — open the dropdown to inspect history.
    await page.getByRole("button", { name: "대화 목록" }).click();
    // The previous thread was never named so it falls back to
    // thread_list.untitled. We assert >= 2 untitled entries to tolerate
    // either-or thread ordering and the fact that both threads show the
    // placeholder title.
    const untitledCount = await page
      .getByText("(제목 없음)")
      .count();
    expect(untitledCount).toBeGreaterThanOrEqual(2);
  });
});
