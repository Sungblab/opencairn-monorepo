import { test, expect } from "@playwright/test";

test.describe("Landing smoke", () => {
  test("ko landing loads, data-theme=cairn-light + data-brand=landing", async ({ page }) => {
    await page.goto("/");
    const brandDiv = page.locator("[data-brand='landing']").first();
    await expect(brandDiv).toHaveAttribute("data-theme", "cairn-light");
    await expect(page.locator("h1").first()).toContainText("읽은 것까지");
  });

  test("en landing loads (ko copy stopgap, URL verified)", async ({ page }) => {
    await page.goto("/en");
    await expect(page.locator("h1").first()).toBeVisible();
    await expect(page).toHaveURL(/\/en$/);
  });

  test("dashboard theme toggle cycles 4 themes and persists", async ({ page }) => {
    test.skip(!process.env.E2E_TEST_USER, "E2E_TEST_USER not set");

    await page.goto("/dashboard");
    const select = page.getByRole("combobox", { name: "Theme" });
    for (const theme of ["cairn-dark", "sepia", "high-contrast", "cairn-light"]) {
      await select.selectOption(theme);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    }
  });
});
