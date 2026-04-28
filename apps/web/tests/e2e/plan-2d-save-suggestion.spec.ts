import { test, expect } from "@playwright/test";
import {
  applySessionCookie,
  seedAndSignIn,
  type SeededSession,
} from "./helpers/seed-session";

// Plan 2D Task 25 — save_suggestion flow E2E.
//
// NOTE: AGENT_STUB_EMIT_SAVE_SUGGESTION env var was removed in Plan 11B-A
// Task 9. save_suggestion now comes from the real Gemini LLM and is no longer
// deterministic. Tests are marked test.skip pending addition of deterministic
// Gemini API mocks.
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
// Follow-up: add deterministic Gemini API mocks. See docs/review/2026-04-28-completion-claims-audit.md.

test.describe("Plan 2D — save_suggestion flow", () => {
  let session: SeededSession;

  test.beforeEach(async ({ context, request, page }) => {
    session = await seedAndSignIn(request);
    await applySessionCookie(context, session);
  });

  // ─── Insert into active Plate note ────────────────────────────────────────

  test.skip("inserts markdown into the active note when Save is clicked on the card", async ({
    page,
  }) => {
    // SKIPPED: AGENT_STUB_EMIT_SAVE_SUGGESTION env var was removed in Plan 11B-A
    // Task 9. save_suggestion now comes from real Gemini and is non-deterministic.
    // Follow-up: add deterministic Gemini API mocks. See docs/review/2026-04-28-completion-claims-audit.md.

    // 1. Open a note tab so the agent panel has a Plate target.
    await page.goto(`/ko/app/w/${session.wsSlug}/`);
    await expect(page).toHaveURL(new RegExp(`/(ko/)?app/w/${session.wsSlug}`), {
      timeout: 15_000,
    });
    await page.getByTestId("new-note-button").click();
    await expect(page).toHaveURL(/\/notes\/[0-9a-f-]{36}$/, {
      timeout: 10_000,
    });

    // 2. Bootstrap an agent thread from the agent panel.
    await expect(page.getByTestId("app-shell-agent-panel")).toBeVisible({
      timeout: 10_000,
    });
    await page.getByRole("button", { name: "첫 대화 시작" }).click();
    const composer = page.getByPlaceholder("메시지를 입력하세요...");
    await expect(composer).toBeEnabled({ timeout: 5_000 });

    // 3. Send the magic "/test-save" message that triggers the stub to emit
    //    the save_suggestion chunk.
    await composer.fill("/test-save please");
    await page.getByRole("button", { name: "전송" }).click();

    // 4. The SaveSuggestionCard appears with the title from the stub payload.
    //    ko: "\"Test note from chat\" 노트로 저장 제안"
    //    en: "Save \"Test note from chat\" as a note?"
    const card = page.getByText(
      /Test note from chat.*노트로 저장 제안|Save.*Test note from chat.*as a note\?/,
    );
    await expect(card).toBeVisible({ timeout: 15_000 });

    // 5. Click the "저장" / "Save" button on the card.
    await page
      .getByRole("button", { name: /^저장$|^Save$/ })
      .first()
      .click();

    // 6. The agent panel inserts the markdown body into the active Plate note.
    //    The stub body contains the heading "# Test note" — check it appears
    //    in the editor body.
    await expect(
      page.getByTestId("note-body").getByText(/Test note/i),
    ).toBeVisible({ timeout: 10_000 });
  });

  // ─── Offer create-new toast for non-Plate tab ──────────────────────────────

  test.skip("offers create-new toast when no active Plate note tab is open", async ({
    page,
  }) => {
    // SKIPPED: AGENT_STUB_EMIT_SAVE_SUGGESTION env var was removed in Plan 11B-A
    // Task 9. save_suggestion now comes from real Gemini and is non-deterministic.
    // Follow-up: add deterministic Gemini API mocks. See docs/review/2026-04-28-completion-claims-audit.md.

    // 1. Navigate to the workspace shell without opening a note tab — the
    //    dashboard landing is not a Plate editor.
    await page.goto(`/ko/app/w/${session.wsSlug}/`);
    await expect(page.getByTestId("app-shell-agent-panel")).toBeVisible({
      timeout: 15_000,
    });

    // 2. Bootstrap thread and send the save-trigger message.
    await page.getByRole("button", { name: "첫 대화 시작" }).click();
    const composer = page.getByPlaceholder("메시지를 입력하세요...");
    await expect(composer).toBeEnabled({ timeout: 5_000 });
    await composer.fill("/test-save please");
    await page.getByRole("button", { name: "전송" }).click();

    // 3. SaveSuggestionCard appears.
    const card = page.getByText(
      /Test note from chat.*노트로 저장 제안|Save.*Test note from chat.*as a note\?/,
    );
    await expect(card).toBeVisible({ timeout: 15_000 });

    // 4. Click Save — since no Plate tab is active the agent panel emits a
    //    "이 채팅을 어디에 저장할까요?" toast with a "새 노트로 만들기" action.
    await page
      .getByRole("button", { name: /^저장$|^Save$/ })
      .first()
      .click();

    // 5. The target-prompt toast appears with the create-new action button.
    //    agentPanel.bubble.save_suggestion_create_new:
    //      ko: "새 노트로 만들기"
    //      en: "Create new note"
    const createNewBtn = page.getByRole("button", {
      name: /새 노트로 만들기|Create new note/,
    });
    await expect(createNewBtn).toBeVisible({ timeout: 5_000 });
    await createNewBtn.click();

    // 6. A new note tab opens containing the stub markdown.
    await expect(page).toHaveURL(/\/notes\/[0-9a-f-]{36}$/, {
      timeout: 10_000,
    });
    await expect(
      page.getByTestId("note-body").getByText(/Test note/i),
    ).toBeVisible({ timeout: 10_000 });
  });
});
