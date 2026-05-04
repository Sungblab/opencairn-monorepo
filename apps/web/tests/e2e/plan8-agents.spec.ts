import { test, expect } from "@playwright/test";
import {
  applySessionCookie,
  seedAndSignIn,
  type SeededSession,
} from "./helpers/seed-session";

const API_BASE = process.env.API_BASE ?? "http://localhost:4000";

test.describe("Plan8 Agents page", () => {
  test.setTimeout(90_000);

  let session: SeededSession;

  test.beforeEach(async ({ context, request }) => {
    session = await seedAndSignIn(request);
    await applySessionCookie(context, session);
  });

  test("renders launch controls and can start Synthesis under mock API", async ({
    page,
    request,
  }) => {
    const overviewRes = await request.get(
      `${API_BASE}/api/agents/plan8/overview?projectId=${session.projectId}`,
    );
    expect(overviewRes.ok()).toBeTruthy();

    await page.goto(
      `/ko/workspace/${session.wsSlug}/project/${session.projectId}/agents`,
      { waitUntil: "domcontentloaded" },
    );

    await expect(page.getByTestId("route-agents")).toBeVisible();
    await expect(page.getByRole("heading", { name: "에이전트" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Synthesis" })).toBeVisible({
      timeout: 45_000,
    });
    await expect(page.getByRole("heading", { name: "Connector" })).toBeVisible();
    await expect(page.getByText("완료")).toBeVisible();
    await expect(page.getByText("종합 인사이트")).toBeVisible();
    await expect(page.getByText(/title: E2E insight/)).toBeVisible();
    await expect(page.getByText("37%")).toBeVisible();
    await expect(page.getByLabel("E2E Mock Note 오디오")).toBeVisible();

    await page.getByRole("button", { name: "e2e-run-synthesis" }).click();
    await expect(
      page.getByRole("heading", { name: "Synthesis 실행 상세" }),
    ).toBeVisible();
    await expect(page.getByText("e2e-synthesis-workflow")).toBeVisible();
    await expect(page.getByRole("link", { name: "Suggestions 보기" })).toHaveAttribute(
      "href",
      "#plan8-suggestions",
    );
    await expect(page.getByRole("button", { name: "실행 취소" })).toBeDisabled();

    await page.getByRole("button", { name: "실행" }).first().click();
    await expect(page.getByText(/Synthesis 실행을 시작했습니다/)).toBeVisible();
  });
});
