import { test, expect } from "@playwright/test";
import {
  applySessionCookie,
  seedAndSignIn,
  type SeededSession,
} from "./helpers/seed-session";

test.describe("Plan8 Agents page", () => {
  let session: SeededSession;

  test.beforeEach(async ({ context, request }) => {
    session = await seedAndSignIn(request);
    await applySessionCookie(context, session);
  });

  test("renders launch controls and can start Synthesis under mock API", async ({
    page,
  }) => {
    await page.goto(
      `/ko/workspace/${session.wsSlug}/project/${session.projectId}/agents`,
    );

    await expect(page.getByTestId("route-agents")).toBeVisible();
    await expect(page.getByRole("heading", { name: "에이전트" })).toBeVisible();
    await expect(page.getByText("Synthesis")).toBeVisible();
    await expect(page.getByText("Connector")).toBeVisible();

    await page.getByRole("button", { name: "실행" }).first().click();
    await expect(page.getByText(/Synthesis 실행을 시작했습니다/)).toBeVisible();
  });
});
