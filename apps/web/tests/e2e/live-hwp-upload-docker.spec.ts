import path from "node:path";

import { test, expect } from "@playwright/test";
import { seedFullStackSession } from "./helpers/full-stack";

test.skip(
  process.env.OPENCAIRN_E2E_LIVE_UPLOAD !== "1" ||
    !process.env.OPENCAIRN_E2E_HWP_PATH,
  "Set OPENCAIRN_E2E_LIVE_UPLOAD=1 and OPENCAIRN_E2E_HWP_PATH to run the live HWP upload smoke.",
);

test.describe("Live HWP upload against Docker", () => {
  test("converts a real HWP into the native PDF viewer and keeps the workflow dock reachable", async ({
    page,
    context,
    request,
  }) => {
    test.setTimeout(360_000);
    const session = await seedFullStackSession(request, context);
    const hwpPath = process.env.OPENCAIRN_E2E_HWP_PATH!;
    const fileName = path.basename(hwpPath);

    await page.goto(`/ko/workspace/${session.wsSlug}/chat-scope`, {
      waitUntil: "domcontentloaded",
    });
    await page.getByRole("button", { name: "E2E Project" }).click();

    await page.getByRole("button", { name: /업로드/ }).first().click();
    await page.locator('input[type="file"]').last().setInputFiles(hwpPath);
    await page.getByTestId("upload-intent-summary").click();

    const [uploadResponse] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.url().includes("/api/ingest/upload") &&
          res.request().method() === "POST",
        { timeout: 60_000 },
      ),
      page.getByRole("button", { name: "업로드 시작" }).click(),
    ]);
    const uploadBody = (await uploadResponse.json()) as {
      workflowId: string;
      originalFileId: string | null;
    };
    expect(uploadResponse.ok(), JSON.stringify(uploadBody)).toBe(true);
    expect(uploadBody.originalFileId).toBeTruthy();

    await expect(page.getByTestId("agent-file-viewer")).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByTestId("agent-file-pdf-viewer")).toBeVisible({
      timeout: 240_000,
    });
    await expect(page.getByTestId("ingest-spotlight")).toHaveCount(0);
    await expect(page.getByTestId("ingest-dock")).toHaveCount(0);

    const tabState = await page.evaluate(
      (wsSlug) =>
        JSON.parse(localStorage.getItem(`oc:tabs:ws_slug:${wsSlug}`) || "{}"),
      session.wsSlug,
    );
    const active = (tabState.tabs || []).find(
      (tab: { id: string }) => tab.id === tabState.activeId,
    );
    expect(active).toMatchObject({
      kind: "agent_file",
      targetId: uploadBody.originalFileId,
    });

    await expect(page.getByText(fileName).first()).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole("button", { name: "원본을 오른쪽에 열기" }).click();
    await expect(page.getByTestId("split-pane-primary")).toBeVisible();
    await expect(page.getByTestId("split-pane-secondary")).toBeVisible();
    await expect(page.getByTestId("split-layout-toolbar")).toBeVisible();

    const terminalToast = page.getByText(/분석이 완료되었습니다|분석에 실패했습니다/).first();
    await expect(terminalToast).toBeVisible({ timeout: 240_000 });
    await expect(terminalToast).not.toContainText("실패");

    await page.getByRole("button", { name: "진행 중인 작업" }).click();
    await expect(page.getByTestId("workspace-bottom-dock")).toBeVisible();
    await expect(page.getByRole("region", { name: "실행 패널" })).toBeVisible();

    console.log(
      JSON.stringify({
        workflowId: uploadBody.workflowId,
        originalFileId: uploadBody.originalFileId,
        activeTab: active,
        hwpPath,
      }),
    );
  });
});
