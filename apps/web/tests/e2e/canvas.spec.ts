import { test, expect } from "@playwright/test";
import {
  applySessionCookie,
  seedAndSignIn,
  type SeededSession,
} from "./helpers/seed-session";

// Plan 7 Canvas Phase 1 — boundary-of-trust verification for the browser
// sandbox runtime. Pyodide load is a real CDN fetch (~10MB) so the first
// run can take 20-30s; subsequent tests reuse the cached worker.
//
// We target /canvas/demo (not the in-app canvas tab) intentionally: the
// demo page bypasses DB + auth + tab-system plumbing, giving us the
// minimum-friction surface for security-critical assertions. The in-app
// flow is covered by Vitest unit tests (CanvasFrame, useCanvasMessages,
// CanvasViewer) plus later phase E2E.
test.describe("Canvas Phase 1 — /canvas/demo", () => {
  let session: SeededSession;

  test.beforeEach(async ({ context, request, page }) => {
    session = await seedAndSignIn(request);
    await applySessionCookie(context, session);
    await page.goto("/ko/canvas/demo?lang=python");
  });

  test("Pyodide runs Python and streams stdout", async ({ page }) => {
    await page
      .locator("textarea[name=source]")
      .fill("for i in range(3): print(i)");
    await page.getByRole("button", { name: /실행|Run/i }).click();
    const stdout = page.locator("[data-testid=stdout]");
    // First load includes WASM download — generous timeout.
    await expect(stdout).toContainText("0", { timeout: 60_000 });
    await expect(stdout).toContainText("1");
    await expect(stdout).toContainText("2");
  });

  test("EXECUTION_TIMEOUT_MS hits 'error' status on infinite loop", async ({
    page,
  }) => {
    await page.locator("textarea[name=source]").fill("while True: pass");
    await page.getByRole("button", { name: /실행|Run/i }).click();
    // 10s execution timeout + status update; allow up to 20s.
    await expect(page.locator("[data-testid=status]")).toContainText(
      /오류|Error/i,
      { timeout: 20_000 },
    );
  });

  test("iframe sandbox attribute is exactly 'allow-scripts'", async ({
    page,
  }) => {
    await page.locator("select[name=language]").selectOption("html");
    await page.locator("textarea[name=source]").fill("<h1>test</h1>");
    // CanvasFrame mounts on source change (no Run click required for non-python).
    const iframe = page.locator("iframe").first();
    await expect(iframe).toBeVisible();
    expect(await iframe.getAttribute("sandbox")).toBe("allow-scripts");
  });

  test("iframe cannot read parent document — postMessage 'BLOCKED' on cookie access", async ({
    page,
  }) => {
    await page.locator("select[name=language]").selectOption("html");
    await page.locator("textarea[name=source]").fill(`
      <script>
        try {
          const c = window.parent.document.cookie;
          parent.postMessage({ type: "LEAK", c }, "*");
        } catch (e) {
          parent.postMessage({ type: "BLOCKED", e: String(e) }, "*");
        }
      </script>
    `);
    // Wait for the iframe to mount (Blob URL in CanvasFrame).
    await expect(page.locator("iframe").first()).toBeVisible();
    const msg = await page.evaluate(
      () =>
        new Promise<unknown>((resolve) => {
          window.addEventListener(
            "message",
            (e) => resolve(e.data),
            { once: true },
          );
          setTimeout(() => resolve({ type: "TIMEOUT" }), 8000);
        }),
    );
    expect((msg as { type: string }).type).toBe("BLOCKED");
  });

  test("Pyodide CDN URL is pinned (no floating tags)", async ({ page }) => {
    const requests: string[] = [];
    page.on("request", (r) => requests.push(r.url()));
    // Re-navigate to capture the initial WASM/script fetches under our recorder.
    await page.goto("/ko/canvas/demo?lang=python");
    await page.locator("textarea[name=source]").fill("print('x')");
    await page.getByRole("button", { name: /실행|Run/i }).click();
    // Give the loader time to issue all requests.
    await page.waitForTimeout(3000);
    const pyodideUrls = requests.filter((u) => u.includes("/pyodide/"));
    expect(pyodideUrls.length).toBeGreaterThan(0);
    expect(pyodideUrls.every((u) => /\/v\d+\.\d+\.\d+\//.test(u))).toBe(true);
    expect(pyodideUrls.every((u) => !u.includes("/latest/"))).toBe(true);
  });

  test("source > 64KB renders the size-error UI and no iframe mounts", async ({
    page,
  }) => {
    await page.locator("select[name=language]").selectOption("html");
    const big = "a".repeat(64 * 1024 + 1);
    await page.locator("textarea[name=source]").fill(big);
    // Error appears as the source state change triggers CanvasFrame's
    // useMemo size check (no Run click needed for non-python languages).
    await expect(page.locator("text=/64KB|exceeds/i")).toBeVisible({
      timeout: 5_000,
    });
    expect(await page.locator("iframe").count()).toBe(0);
  });
});
