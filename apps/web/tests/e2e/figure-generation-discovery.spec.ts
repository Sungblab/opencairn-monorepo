import { expect, test } from "@playwright/test";
import {
  applySessionCookie,
  seedAndSignIn,
  type SeededSession,
} from "./helpers/seed-session";

test.describe("Figure generation discovery", () => {
  test.setTimeout(60_000);

  let session: SeededSession;

  test.beforeEach(async ({ context, page, request }) => {
    session = await seedAndSignIn(request);
    await applySessionCookie(context, session);
    await page.route("**/api/projects/*/document-generation/sources", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ sources: [] }),
      }),
    );
  });

  test("project tools open figure and document presets in Activity", async ({
    page,
  }) => {
    await page.goto(
      `/ko/workspace/${session.wsSlug}/project/${session.projectId}`,
      {
        waitUntil: "domcontentloaded",
      },
    );

    await expect(
      page.getByRole("button", { name: /근거 기반 그림 만들기/ }),
    ).toBeVisible();
    await page.getByRole("button", { name: /근거 기반 그림 만들기/ }).click();

    await expect(page.getByRole("button", { name: /피규어 만들기/ })).toBeVisible();
    await expect(page.getByLabel("format")).toHaveValue("image");
    await expect(page.getByLabel("template")).toHaveValue("research_brief");
    await expect(page.getByLabel("image engine")).toHaveValue("svg");
    await expect(page.getByRole("button", { name: /피규어 생성 시작/ })).toBeDisabled();

    await page.getByRole("button", { name: /PDF 보고서 만들기/ }).click();

    await expect(page.getByRole("button", { name: /문서 생성/ })).toBeVisible();
    await expect(page.getByLabel("format")).toHaveValue("pdf");
    await expect(page.getByLabel("template")).toHaveValue("technical_report");
    await expect(page.getByLabel("render engine")).toHaveValue("pymupdf");
    await expect(page.getByRole("button", { name: /^생성 시작$/ })).toBeDisabled();
  });
});
