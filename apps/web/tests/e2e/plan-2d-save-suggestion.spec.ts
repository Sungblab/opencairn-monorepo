import { test, expect } from "@playwright/test";
import {
  applySessionCookie,
  seedAndSignIn,
  type SeededSession,
} from "./helpers/seed-session";
import {
  fulfillAgentSaveSuggestionStream,
  fulfillPersistedSaveSuggestionMessages,
} from "./helpers/sse-fixtures";

const ACTIVE_THREAD_ID = "fixture-thread";

// Plan 2D Task 25 — save_suggestion flow E2E.
//
// NOTE: AGENT_STUB_EMIT_SAVE_SUGGESTION env var was removed in Plan 11B-A
// Task 9. save_suggestion now comes from the real Gemini LLM. This spec keeps
// the user-facing UI path executable by mocking only the thread SSE + playback
// responses at the Playwright boundary; product code still exercises the real
// AgentPanel, SaveSuggestionCard, and missing-target toast path.
//
// The SaveSuggestionCard (components/agent-panel/save-suggestion-card.tsx)
// renders the i18n text from agentPanel.bubble.save_suggestion_prefix:
//   ko: "\"Test note from chat\" 노트로 저장 제안"
//   en: "Save \"Test note from chat\" as a note?"
//
// When the user clicks the "저장" / "Save" button on the card:
//   - If the active tab is a Plate note: the markdown body is inserted into
//     the editor and a success toast fires.
//   - If there is no active Plate note tab: a "이 채팅을 어디에 저장할까요?"
//     toast with a "새 노트로 만들기" / "Create new note" action fires,
//     and clicking it creates a new note tab showing the content.
//
test.describe("Plan 2D — save_suggestion flow", () => {
  let session: SeededSession;

  test.beforeEach(async ({ context, request, page }) => {
    session = await seedAndSignIn(request);
    await applySessionCookie(context, session);
  });

  test("renders save_suggestion and offers create-new when no Plate note is active", async ({
    page,
  }) => {
    if (!session.workspaceId || !session.wsSlug) {
      throw new Error("default E2E seed must return workspaceId and wsSlug");
    }
    let sent = false;
    await page.route(
      `**/api/workspaces/by-slug/${session.wsSlug}`,
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            id: session.workspaceId,
            slug: session.wsSlug,
            name: "E2E Mock Workspace",
          }),
        });
      },
    );
    await page.route("**/api/threads/*/messages", async (route) => {
      if (route.request().method() === "POST") {
        sent = true;
        await fulfillAgentSaveSuggestionStream(route);
        return;
      }
      await fulfillPersistedSaveSuggestionMessages(route, sent);
    });

    await page.goto(`/ko/workspace/${session.wsSlug}/chat-scope`);
    await page.evaluate(
      ({ workspaceId, threadId }) => {
        localStorage.setItem(
          `oc:active_thread:${workspaceId}`,
          JSON.stringify(threadId),
        );
      },
      { workspaceId: session.workspaceId, threadId: ACTIVE_THREAD_ID },
    );
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("app-shell-agent-panel")).toBeVisible({
      timeout: 15_000,
    });

    const composer = page.getByPlaceholder("메시지를 입력하세요...");
    await expect(composer).toBeEnabled({ timeout: 5_000 });

    await composer.fill("/fixture-save");
    await page.getByRole("button", { name: "전송" }).click();

    const card = page.getByText(
      /Fixture note from chat.*노트로 저장 제안|Save.*Fixture note from chat.*as a note\?/,
    );
    await expect(card).toBeVisible({ timeout: 15_000 });

    await page
      .getByRole("button", { name: /^저장$|^Save$/ })
      .first()
      .click();

    await expect(page.getByText("이 채팅을 어디에 저장할까요?")).toBeVisible({
      timeout: 5_000,
    });
    await expect(
      page.getByRole("button", { name: "새 노트로 만들기" }),
    ).toBeVisible();
  });

  // ─── Insert into active Plate note ────────────────────────────────────────

  test.skip("inserts markdown into the active note when Save is clicked on the card", async ({
    page: _page,
  }) => {
    // SKIPPED: the current (shell)/note/[noteId] route renders a placeholder
    // rather than the real Plate editor, while the legacy Plate editor route
    // does not mount the Agent Panel. Keep this as manual-only debt until
    // the editor and AgentPanel share one shell route.
  });
});
