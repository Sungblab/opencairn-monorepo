import { test, expect } from "@playwright/test";
import {
  applySessionCookie,
  seedAndSignIn,
  type SeededSession,
} from "./helpers/seed-session";

// Plan 2D Task 24 — chat renderer E2E.
//
// The stub `runAgent` in apps/api/src/lib/agent-pipeline.ts echoes the user
// message verbatim, so we control the markdown the renderer sees by sending
// markdown as the user message. All assertions use data-testids from the
// actual implementations:
//
//   code-block-lang      components/chat/renderers/code-block.tsx
//   code-block-copy      components/chat/renderers/code-block.tsx
//   mermaid-chat         components/chat/renderers/mermaid-chat.tsx
//   mermaid-chat-error   components/chat/renderers/mermaid-chat.tsx
//   chat-message-renderer components/chat/chat-message-renderer.tsx
//   chat-callout-{kind}  components/chat/renderers/callout-blockquote.tsx
//
// Infra required: Postgres + API on :4000 + web on :3000.
// E2E deferred to CI (per Plan 2D conventions, same as Plan 7 Phase 2).

test.describe("Plan 2D — chat renderer", () => {
  let session: SeededSession;

  test.beforeEach(async ({ context, request, page }) => {
    session = await seedAndSignIn(request);
    await applySessionCookie(context, session);

    // Navigate to the workspace shell — the agent panel is always visible here.
    await page.goto(`/ko/workspace/${session.wsSlug}/`);
    await expect(page.getByTestId("app-shell-agent-panel")).toBeVisible({
      timeout: 15_000,
    });

    // Bootstrap a thread by clicking the "첫 대화 시작" CTA (empty_state.start_cta).
    await page.getByRole("button", { name: "첫 대화 시작" }).click();
    // The placeholder textarea appears once the thread is active.
    await expect(
      page.getByPlaceholder("메시지를 입력하세요..."),
    ).toBeEnabled({ timeout: 5_000 });
  });

  // ─── Code block ───────────────────────────────────────────────────────────

  test("renders a fenced JS code block with a copy button and lang label", async ({
    page,
  }) => {
    const composer = page.getByPlaceholder("메시지를 입력하세요...");
    await composer.fill("```js\nconst x = 1;\n```");
    await page.getByRole("button", { name: "전송" }).click();

    // The stub echoes the message — wait for the agent bubble containing the
    // code block renderer (code-block.tsx wraps `code-block-lang` and `code-block-copy`).
    await expect(page.getByTestId("code-block-lang")).toContainText("js", {
      timeout: 10_000,
    });
    await expect(page.getByTestId("code-block-copy")).toBeVisible();
  });

  // ─── Mermaid block ────────────────────────────────────────────────────────

  test("renders a mermaid block from a chat message", async ({ page }) => {
    const composer = page.getByPlaceholder("메시지를 입력하세요...");
    await composer.fill("```mermaid\ngraph TD\nA --> B\n```");
    await page.getByRole("button", { name: "전송" }).click();

    // mermaid-chat.tsx renders either the rendered SVG or an error element.
    // Both are acceptable — the renderer must not silently swallow the block.
    await expect(
      page
        .getByTestId("mermaid-chat")
        .or(page.getByTestId("mermaid-chat-error")),
    ).toBeVisible({ timeout: 15_000 });
  });

  // ─── GFM table ────────────────────────────────────────────────────────────

  test("renders a GFM table", async ({ page }) => {
    const composer = page.getByPlaceholder("메시지를 입력하세요...");
    await composer.fill("| a | b |\n|---|---|\n| 1 | 2 |");
    await page.getByRole("button", { name: "전송" }).click();

    // chat-message-renderer.tsx wraps all rendered markdown in the testid wrapper.
    await expect(
      page.locator("[data-testid='chat-message-renderer'] table"),
    ).toBeVisible({ timeout: 10_000 });
  });

  // ─── XSS guard ────────────────────────────────────────────────────────────

  test("strips a <script> tag from raw HTML in the message", async ({
    page,
  }) => {
    const composer = page.getByPlaceholder("메시지를 입력하세요...");
    await composer.fill("<script>window.PWN=1</script>safe content");
    await page.getByRole("button", { name: "전송" }).click();

    // The safe text content should appear in the agent bubble.
    await expect(page.getByText("safe content")).toBeVisible({
      timeout: 10_000,
    });
    // The script must NOT have executed.
    const pwn = await page.evaluate(
      () => (window as Window & { PWN?: unknown }).PWN,
    );
    expect(pwn).toBeUndefined();
  });

  // ─── Callout blockquote ───────────────────────────────────────────────────

  test("renders > [!warn] as a styled callout", async ({ page }) => {
    const composer = page.getByPlaceholder("메시지를 입력하세요...");
    await composer.fill("> [!warn] caution\n\ncontent");
    await page.getByRole("button", { name: "전송" }).click();

    // callout-blockquote.tsx: data-testid="chat-callout-warn".
    await expect(page.getByTestId("chat-callout-warn")).toBeVisible({
      timeout: 10_000,
    });
  });
});
