import { test, expect } from "@playwright/test";
import { type SeededSession } from "./helpers/seed-session";
import { seedFullStackSession } from "./helpers/full-stack";

// App Shell Phase 4 Task 12 — Agent Panel happy paths.
//
// These smoke tests assert deterministic shell behavior and the thread SSE UI
// path against the Playwright mock API. Full-stack chat execution also needs
// Temporal + the worker and is covered by API/worker integration tests.
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

  async function sendMessageAndWaitForResponse(
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
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    await expect(page.getByText("Mock agent response.")).toBeVisible();
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

  test("sends a message through the thread SSE route", async ({
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

    const response = await responsePromise;
    expect(response.status()).toBe(200);
    await expect(page.getByText("Mock agent response.")).toBeVisible();
    await expect(ta).toHaveValue("");
  });

  test("shows the user turn before the agent response", async ({
    page,
  }) => {
    await page.goto(`/ko/workspace/${session.wsSlug}/`);
    await ensureAgentPanelOpen(page);
    await sendMessageAndWaitForResponse(page, "hi");

    const userBox = await page.getByText("hi").boundingBox();
    const responseBox = await page.getByText("Mock agent response.").boundingBox();
    expect(userBox?.y).toBeLessThan(responseBox?.y ?? 0);
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
    await expect(page.getByRole("menu")).toContainText("Fixture thread");
  });
});
