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
//   - If the active tab is a project: the markdown body is saved as a new note
//     in that project and opened as an editable note tab.
//
test.describe("Plan 2D — save_suggestion flow", () => {
  test.setTimeout(60_000);

  let session: SeededSession;

  test.beforeEach(async ({ context, request, page }) => {
    session = await seedAndSignIn(request);
    await applySessionCookie(context, session);
  });

  test("renders save_suggestion and creates a note from project context", async ({
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

    await page.addInitScript(
      ({ workspaceId, threadId }) => {
        localStorage.removeItem(`oc:tabs:${workspaceId}`);
        localStorage.setItem(
          `oc:active_thread:${workspaceId}`,
          JSON.stringify(threadId),
        );
      },
      { workspaceId: session.workspaceId, threadId: ACTIVE_THREAD_ID },
    );
    await page.goto(
      `/ko/workspace/${session.wsSlug}/project/${session.projectId}`,
    );
    await page.getByRole("button", { name: "에이전트 패널 펼치기" }).click();
    await expect(page.getByTestId("app-shell-agent-panel")).toBeVisible({
      timeout: 15_000,
    });

    const composer = page.getByPlaceholder("질문하거나 /명령어를 입력하세요...");
    await expect(composer).toBeEnabled({ timeout: 5_000 });

    await composer.fill("/fixture-save");
    await composer.press("Enter");

    const saveButton = page.getByRole("button", { name: /^저장$|^Save$/ }).first();
    await expect(saveButton).toBeVisible({ timeout: 20_000 });
    await saveButton.click();

    await expect(page.getByText("새 노트를 만들었어요")).toBeVisible({
      timeout: 5_000,
    });
    await expect(
      page.getByRole("tab", { name: /Fixture note from chat/ }),
    ).toBeVisible();
  });

  // ─── Insert into active Plate note ────────────────────────────────────────

  test("inserts markdown into the active note when Save is clicked on the card", async ({
    page,
  }) => {
    if (!session.workspaceId || !session.wsSlug) {
      throw new Error("default E2E seed must return workspaceId and wsSlug");
    }
    let sent = false;
    await page.route("**/api/threads/*/messages", async (route) => {
      if (route.request().method() === "POST") {
        sent = true;
        await fulfillAgentSaveSuggestionStream(route);
        return;
      }
      await fulfillPersistedSaveSuggestionMessages(route, sent);
    });

    await page.addInitScript(
      ({ workspaceId, threadId }) => {
        localStorage.removeItem(`oc:tabs:${workspaceId}`);
        localStorage.setItem(
          `oc:active_thread:${workspaceId}`,
          JSON.stringify(threadId),
        );
      },
      { workspaceId: session.workspaceId, threadId: ACTIVE_THREAD_ID },
    );
    await page.goto(`/ko/workspace/${session.wsSlug}/note/${session.noteId}`);
    await page.getByRole("button", { name: "에이전트 패널 펼치기" }).click();
    await expect(page.getByTestId("app-shell-agent-panel")).toBeVisible({
      timeout: 15_000,
    });

    const composer = page.getByPlaceholder("질문하거나 /명령어를 입력하세요...");
    await expect(composer).toBeEnabled({ timeout: 5_000 });

    await composer.fill("/fixture-save");
    await composer.press("Enter");

    const saveButton = page.getByRole("button", { name: /^저장$|^Save$/ }).first();
    await expect(saveButton).toBeVisible({ timeout: 20_000 });
    await saveButton.click();

    await expect(page.getByText("현재 노트에 추가했어요")).toBeVisible({
      timeout: 5_000,
    });
  });
});
