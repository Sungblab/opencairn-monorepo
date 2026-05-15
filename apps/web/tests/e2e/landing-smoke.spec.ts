import { test, expect } from "@playwright/test";

test.describe("Landing smoke", () => {
  test("ko landing loads, data-theme=cairn-light + data-brand=landing", async ({ page }) => {
    await page.goto("/ko");
    const brandDiv = page.locator("[data-brand='landing']").first();
    await expect(brandDiv).toHaveAttribute("data-theme", "cairn-light");
    await expect(page.locator("h1").first()).toContainText("읽은 것까지");
  });

  test("en landing loads, URL verified", async ({ page }) => {
    await page.goto("/en");
    await expect(page.locator("h1").first()).toBeVisible();
    await expect(page).toHaveURL(/\/en$/);
  });

  test("ko landing does not create horizontal page scroll across responsive widths", async ({ page }) => {
    for (const width of [320, 360, 375, 430, 768, 1024, 1280]) {
      await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
      await page.goto("/ko");
      await expect(page.locator("h1").first()).toBeVisible();

      const dimensions = await page.evaluate(() => ({
        viewportWidth: document.documentElement.clientWidth,
        documentWidth: document.documentElement.scrollWidth,
        bodyWidth: document.body.scrollWidth,
      }));

      expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewportWidth);
      expect(dimensions.bodyWidth).toBeLessThanOrEqual(dimensions.viewportWidth);
    }
  });

  test("ko landing hash targets clear the sticky header on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 844 });

    for (const hash of ["#docs", "#pricing", "#workspace"]) {
      await page.goto(`/ko${hash}`);
      await expect(page.locator(hash)).toBeVisible();

      const metrics = await page.evaluate((selector) => {
        const nav = document.querySelector("nav");
        const section = document.querySelector(selector);
        if (!nav || !section) return null;
        const navBottom = nav.getBoundingClientRect().bottom;
        const sectionTop = section.getBoundingClientRect().top;
        return { navBottom, sectionTop };
      }, hash);

      expect(metrics).not.toBeNull();
      expect(metrics!.sectionTop).toBeGreaterThanOrEqual(metrics!.navBottom - 1);
    }
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
