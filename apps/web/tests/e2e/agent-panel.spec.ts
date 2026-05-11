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
  const composerPlaceholder = "질문하거나 /명령어를 입력하세요...";

  async function ensureAgentPanelOpen(page: import("@playwright/test").Page) {
    const panel = page.getByTestId("app-shell-agent-panel");
    if ((await panel.count()) === 0 || !(await panel.first().isVisible())) {
      const openButton = page.getByRole("button", {
        name: "에이전트 패널 펼치기",
      });
      if (await openButton.isVisible()) {
        await openButton.click();
      } else {
        await page.keyboard.press("Control+j");
      }
    }
    await expect(panel).toBeVisible();
  }

  async function sendMessageAndWaitForStreamStart(
    page: import("@playwright/test").Page,
    content: string,
  ) {
    const responsePromise = page.waitForResponse(
      (res) =>
        res.url().includes("/api/threads/") &&
        res.url().endsWith("/messages") &&
        res.request().method() === "POST",
    );
    const ta = page.getByPlaceholder(composerPlaceholder);
    await ta.fill(content);
    await ta.press("Enter");
    await expect(page.getByText(content)).toBeVisible();
    await expect(page.getByText("답변 준비 중")).toBeVisible();
    const response = await responsePromise;
    expect(response.status()).toBe(200);
  }

  test.beforeEach(async ({ context, request }) => {
    session = await seedFullStackSession(request, context);
  });

  test("empty state shows on first visit and starts a thread", async ({
    page,
  }) => {
    await page.goto(`/ko/workspace/${session.wsSlug}/`);
    await ensureAgentPanelOpen(page);
    await expect(page.getByText("새 대화")).toBeVisible();
    await expect(page.getByPlaceholder(composerPlaceholder)).toBeEnabled();
  });

  test("sends a message through the full-stack thread SSE route", async ({
    page,
  }) => {
    await page.goto(`/ko/workspace/${session.wsSlug}/`);
    await ensureAgentPanelOpen(page);

    const ta = page.getByPlaceholder(composerPlaceholder);
    await expect(ta).toBeEnabled();

    const responsePromise = page.waitForResponse(
      (res) =>
        res.url().includes("/api/threads/") &&
        res.url().endsWith("/messages") &&
        res.request().method() === "POST",
    );
    await ta.fill("e2e agent smoke");
    await ta.press("Enter");
    await expect(page.getByText("e2e agent smoke")).toBeVisible();
    await expect(page.getByText("답변 준비 중")).toBeVisible();

    const response = await responsePromise;
    expect(response.status()).toBe(200);
    await expect(ta).toHaveValue("");
  });

  test("shows the user turn before the streaming loading state", async ({
    page,
  }) => {
    await page.goto(`/ko/workspace/${session.wsSlug}/`);
    await ensureAgentPanelOpen(page);
    await sendMessageAndWaitForStreamStart(page, "hi");

    const userBox = await page.getByText("hi").boundingBox();
    const loadingBox = await page.getByText("답변 준비 중").boundingBox();
    expect(userBox?.y).toBeLessThan(loadingBox?.y ?? 0);
  });

  test("new thread via + preserves previous thread in list", async ({
    page,
  }) => {
    await page.goto(`/ko/workspace/${session.wsSlug}/`);
    await ensureAgentPanelOpen(page);
    await page.getByRole("button", { name: "새 대화" }).click();
    await expect(page.getByPlaceholder(composerPlaceholder)).toBeEnabled();

    // header.new_thread_aria — spawns a second thread and activates it.
    await page.getByRole("button", { name: "새 대화" }).click();
    // header.thread_list_aria — open the dropdown to inspect history.
    await page.getByRole("button", { name: "에이전트 기록 열기" }).click();
    // The previous thread was never named so it falls back to
    // thread_list.untitled. We assert >= 2 untitled entries to tolerate
    // either-or thread ordering and the fact that both threads show the
    // placeholder title.
    await expect(
      page.getByRole("button", { name: /^\(제목 없음\)/ }),
    ).toHaveCount(2);
  });
});
