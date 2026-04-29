import { test, expect } from "@playwright/test";
import {
  applySessionCookie,
  seedAndSignIn,
  type SeededSession,
} from "./helpers/seed-session";

// Plan 7 Canvas Phase 2 — end-to-end coverage for the Code Agent + canvas
// outputs flow. The plan calls out 7 scenarios; only 2 are runnable in CI
// today because the rest depend on FEATURE_CODE_AGENT=true plus a live
// Temporal worker plus LLM credentials. Those 5 are written with plausible
// bodies so that flipping `test.skip` off (and wiring a fake LLM in CI)
// turns them on without needing to author tests later.
//
// Locators reference data-testids that the components actually emit:
//   - canvas-viewer-toolbar           viewers/canvas-viewer.tsx
//   - code-agent-panel / agent-*      components/canvas/CodeAgentPanel.tsx
//   - canvas-outputs-gallery, output-save, saved-output, pending-figure
//                                     components/canvas/CanvasOutputsGallery.tsx
//   - python iframe status/stdout/stderr now live inside the sandboxed
//     CanvasFrame iframe (sandbox-html-template.ts), not in the main page.
// Mode-switch UI lives behind the tab context menu (right-click) → "모드 변경"
// submenu → "읽기 전용" radio item, per components/tab-shell/tab-mode-submenu.tsx.

const REQUIRES_FULL_STACK =
  "Requires FEATURE_CODE_AGENT=true + Temporal worker + LLM credentials — wire up in deferred CI job";

const API_BASE = process.env.API_BASE ?? "http://localhost:4000";

test.describe("Plan 7 Canvas Phase 2 — Code Agent + outputs", () => {
  // ───────────────────────────────────────────────────────────────────────
  // Hold-back: needs the full Code Agent stack. Skipped in CI today; bodies
  // are kept realistic so unblocking is just removing the .skip.
  // ───────────────────────────────────────────────────────────────────────
  test.describe("Hold-back (full-stack)", () => {
    test.skip(true, REQUIRES_FULL_STACK);

    let session: SeededSession;
    test.beforeEach(async ({ context, request, page }) => {
      session = await seedAndSignIn(request, { mode: "canvas-phase2" });
      await applySessionCookie(context, session);
      await page.goto(`/ko/app/w/${session.wsSlug}/n/${session.noteId}`);
    });

    test("1. New Canvas → generate → turn_complete + Apply enabled", async ({
      page,
    }) => {
      // Type a prompt into the Code Agent panel and run it.
      await page
        .getByTestId("agent-prompt")
        .fill("Print numbers 0 through 4 with a for-loop");
      await page.getByTestId("agent-run").click();

      // Streaming "running" state appears almost immediately; the final
      // turn_complete frame replaces it with the agent-preview + Apply.
      await expect(page.getByTestId("agent-running")).toBeVisible({
        timeout: 5_000,
      });
      await expect(page.getByTestId("agent-preview")).toBeVisible({
        timeout: 60_000,
      });
      await expect(page.getByTestId("agent-apply")).toBeEnabled();
    });

    test("2. Apply → Run → success path (stdout)", async ({ page }) => {
      await page
        .getByTestId("agent-prompt")
        .fill("Print 'agent-ok' to stdout");
      await page.getByTestId("agent-run").click();
      await expect(page.getByTestId("agent-apply")).toBeEnabled({
        timeout: 60_000,
      });
      await page.getByTestId("agent-apply").click();

      // Apply hands code to MonacoEditor → Run executes inside the Pyodide
      // sandbox; stdout streams from the iframe via postMessage.
      await page.getByRole("button", { name: /실행|Run/i }).click();
      await expect(page.getByTestId("stdout")).toContainText("agent-ok", {
        timeout: 60_000,
      });
    });

    test("3. Apply → Run → error → feedback → fix turn", async ({ page }) => {
      await page
        .getByTestId("agent-prompt")
        .fill("Write code that divides by zero so the run errors");
      await page.getByTestId("agent-run").click();
      await expect(page.getByTestId("agent-apply")).toBeEnabled({
        timeout: 60_000,
      });
      await page.getByTestId("agent-apply").click();
      await page.getByRole("button", { name: /실행|Run/i }).click();
      await expect(page.getByTestId("status")).toContainText(/오류|Error/i, {
        timeout: 20_000,
      });

      // Feed the error back as the next agent turn — the panel should pick
      // up the previous run's failure context and produce a fix.
      await page
        .getByTestId("agent-prompt")
        .fill("Fix the ZeroDivisionError so the program runs cleanly");
      await page.getByTestId("agent-run").click();
      await expect(page.getByTestId("agent-turns")).toContainText(/2|two/i, {
        timeout: 60_000,
      });
    });

    test("4. matplotlib figure → Save → outputs gallery has 1", async ({
      page,
    }) => {
      const mplSource = [
        "import matplotlib.pyplot as plt",
        "fig, ax = plt.subplots()",
        "ax.plot([0, 1, 2], [0, 1, 4])",
        "plt.show()",
      ].join("\n");
      await page.getByTestId("agent-prompt").fill(mplSource);
      await page.getByTestId("agent-run").click();
      await expect(page.getByTestId("agent-apply")).toBeEnabled({
        timeout: 60_000,
      });
      await page.getByTestId("agent-apply").click();
      await page.getByRole("button", { name: /실행|Run/i }).click();

      // CanvasFrame's CANVAS_PYTHON_RESULT message harvests figures into
      // pendingFigures; the gallery shows them with a Save button until the
      // user persists.
      await expect(page.getByTestId("pending-figure").first()).toBeVisible({
        timeout: 60_000,
      });
      await page.getByTestId("output-save").first().click();
      await expect(page.getByTestId("saved-output")).toHaveCount(1, {
        timeout: 10_000,
      });
    });

    test("5. max_turns reached", async ({ page }) => {
      // The Code Agent should bail after the configured turn cap (default
      // 8). When that happens the SSE stream ends with done.status="error"
      // + errorCode="maxTurnsReached"; the panel surfaces the latter as
      // localized copy under agent-done.
      await page
        .getByTestId("agent-prompt")
        .fill("Loop on yourself and never produce a final answer");
      await page.getByTestId("agent-run").click();
      await expect(page.getByTestId("agent-done")).toContainText(
        /max|turns|한도/i,
        { timeout: 120_000 },
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // Active: pure UI / pure HTTP, no Temporal involvement. Always run.
  // ───────────────────────────────────────────────────────────────────────
  test.describe("UI-only (always run)", () => {
    let session: SeededSession;

    test.beforeEach(async ({ context, request }) => {
      session = await seedAndSignIn(request, { mode: "canvas-phase2" });
      await applySessionCookie(context, session);
    });

    test("6. Tab Mode switch canvas → reading", async ({ page }) => {
      await page.goto(`/ko/app/w/${session.wsSlug}/n/${session.noteId}`);
      // Canvas viewer is the default for sourceType='canvas' notes — confirm
      // the viewer toolbar mounts before we attempt the mode switch.
      await expect(page.getByTestId("canvas-viewer-toolbar")).toBeVisible({
        timeout: 30_000,
      });

      const tab = page.locator('[role="tab"]').first();
      await expect(tab).toBeVisible();
      // Right-click the active tab → "모드 변경" submenu → "읽기 전용".
      // The submenu items are radio items so we use the bilingual regex
      // to stay resilient to copy adjustments and English locale runs.
      await tab.click({ button: "right" });
      await page
        .getByRole("menuitem", { name: /모드 변경|Change mode/i })
        .click();
      await page
        .getByRole("menuitemradio", { name: /읽기 전용|Reading/i })
        .click();

      // The canvas toolbar disappears and the reading viewer takes over.
      await expect(page.getByTestId("canvas-viewer-toolbar")).toHaveCount(0);
      await expect(page.getByTestId("reading-viewer")).toBeVisible();
    });

    test("7. /api/canvas/from-template returns 501 with flag off", async ({
      request,
    }) => {
      const r = await request.post(`${API_BASE}/api/canvas/from-template`, {
        headers: {
          cookie: `${session.cookieName}=${session.cookieValue}`,
          "content-type": "application/json",
        },
        data: {
          // Both fields are uuid()-validated by zod; using random-ish
          // fixed UUIDs keeps the test deterministic without depending on
          // any pre-existing template/project rows.
          projectId: "00000000-0000-0000-0000-000000000001",
          templateId: "00000000-0000-0000-0000-000000000002",
        },
      });
      expect(r.status()).toBe(501);
      const body = (await r.json()) as { error?: string };
      expect(body.error).toBe("templatesNotAvailable");
    });
  });
});
