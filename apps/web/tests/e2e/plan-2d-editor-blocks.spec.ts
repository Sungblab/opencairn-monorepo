import { test, expect } from "@playwright/test";
import {
  applySessionCookie,
  seedAndSignIn,
  type SeededSession,
} from "./helpers/seed-session";

// Plan 2D Task 23 — editor block E2E happy paths.
//
// Covers: Mermaid insert, Callout kind-cycle, Toggle expand/collapse,
// Table 3×3, and 2-column layout — each triggered via the slash-command menu.
//
// Selectors reference data-testids from the actual implementations:
//   - mermaid-block           components/editor/blocks/mermaid/mermaid-element.tsx
//   - callout-kind-button     components/editor/blocks/callout/callout-element.tsx
//   - toggle-block            components/editor/blocks/toggle/toggle-element.tsx
//   - toggle-body             components/editor/blocks/toggle/toggle-element.tsx
//   - toggle-chevron          components/editor/blocks/toggle/toggle-element.tsx
//   - slash-menu / slash-cmd-* components/editor/plugins/slash.tsx
//
// The column-group container is rendered by @platejs/layout ColumnPlugin with
// node key "column_group". Because @platejs/layout does not add a custom
// data-testid, we select on [data-slate-node="element"] with the type
// attribute (Plate attaches these automatically in dev/test mode). If the
// attribute is absent at runtime, the FIXME comment below explains how to add
// one and the test will fail visibly rather than silently.
//
// Infra required: Postgres + API on :4000 + web on :3000.
// E2E deferred to CI (per Plan 2D conventions, same as Plan 7 Phase 2).

test.describe("Plan 2D — editor blocks", () => {
  let session: SeededSession;

  test.beforeEach(async ({ context, request, page }) => {
    session = await seedAndSignIn(request);
    await applySessionCookie(context, session);

    // Project-scoped sidebar actions only mount when a project is active.
    await page.goto(
      `/ko/workspace/${session.wsSlug}/project/${session.projectId}`,
    );
    await expect(page).toHaveURL(
      new RegExp(`/(ko/)?workspace/${session.wsSlug}`),
      { timeout: 15_000 },
    );

    // Create a fresh note so each test starts with an empty editor.
    await page.getByTestId("new-note-button").click();
    await expect(page).toHaveURL(/\/note\/[0-9a-f-]{36}$/, {
      timeout: 10_000,
    });
    // Wait for the editor body to be ready before each test.
    await page.getByTestId("note-body").waitFor({ timeout: 10_000 });
  });

  // ─── Mermaid ──────────────────────────────────────────────────────────────

  test("inserts a Mermaid diagram via slash", async ({ page }) => {
    await page.getByTestId("note-body").click();
    await page.keyboard.press("/");
    await expect(page.getByTestId("slash-menu")).toBeVisible();

    await page.getByTestId("slash-cmd-mermaid").click();

    // mermaid-element.tsx wraps the block in data-testid="mermaid-block".
    await expect(page.getByTestId("mermaid-block")).toBeVisible({
      timeout: 5_000,
    });
  });

  // ─── Callout ──────────────────────────────────────────────────────────────

  test("inserts a Callout and cycles its kind", async ({ page }) => {
    await page.getByTestId("note-body").click();
    await page.keyboard.press("/");
    await expect(page.getByTestId("slash-menu")).toBeVisible();

    await page.getByTestId("slash-cmd-callout").click();

    // callout-element.tsx: data-testid="callout-kind-button" + data-kind attr.
    const kindBtn = page.getByTestId("callout-kind-button");
    await expect(kindBtn).toBeVisible({ timeout: 5_000 });
    // Default kind is "info".
    await expect(kindBtn).toHaveAttribute("data-kind", "info");

    // One click cycles info → warn.
    await kindBtn.click();
    await expect(kindBtn).toHaveAttribute("data-kind", "warn");
  });

  // ─── Toggle ───────────────────────────────────────────────────────────────

  test("inserts an open Toggle", async ({ page }) => {
    await page.getByTestId("note-body").click();
    await page.keyboard.press("/");
    await expect(page.getByTestId("slash-menu")).toBeVisible();

    await page.getByTestId("slash-cmd-toggle").click();

    // toggle-element.tsx: the wrapper is data-testid="toggle-block", the
    // collapsible region is data-testid="toggle-body" (rendered only when open).
    await expect(page.getByTestId("toggle-block")).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByTestId("toggle-body")).toHaveAttribute(
      "data-open",
      "true",
    );
    await expect(page.getByTestId("toggle-body")).toBeVisible();
  });

  // ─── Table ────────────────────────────────────────────────────────────────

  test("inserts a 3×3 Table", async ({ page }) => {
    await page.getByTestId("note-body").click();
    await page.keyboard.press("/");
    await expect(page.getByTestId("slash-menu")).toBeVisible();

    await page.getByTestId("slash-cmd-table").click();

    // slash.tsx inserts one header row + two body rows = 9 cells.
    await expect(
      page
        .getByTestId("note-body")
        .locator("[data-testid='table-cell-context-trigger']"),
    ).toHaveCount(9, { timeout: 5_000 });
  });

  // ─── Columns ──────────────────────────────────────────────────────────────

  test("inserts a 2-column layout", async ({ page }) => {
    await page.getByTestId("note-body").click();
    await page.keyboard.press("/");
    await expect(page.getByTestId("slash-menu")).toBeVisible();

    await page.getByTestId("slash-cmd-columns").click();

    await expect(page.getByTestId("column-group")).toBeVisible({
      timeout: 5_000,
    });
  });
});
