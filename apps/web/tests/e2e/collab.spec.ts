import { test, expect, type Browser } from "@playwright/test";

import {
  applySessionCookieFor,
  seedMultiRoleAndSignIn,
  type UserCookie,
} from "./helpers/seed-session";

// Plan 2B Task 20 — multi-browser collab E2E.
//
// Infra required (NOT auto-started by Playwright):
//   - Postgres  (docker compose)
//   - API       (apps/api on :4000 — Playwright's webServer does spawn this)
//   - web       (apps/web on :3000 — Playwright's webServer spawns this too)
//   - Hocuspocus server at ws://localhost:1234 — MUST be running manually.
//     `pnpm --filter @opencairn/hocuspocus dev` in a separate shell.
//
// The real-time sync assertions will fail after ~5s if Hocuspocus is down;
// that's a clear, fast signal rather than a silent hang. Spawning Hocuspocus
// from within Playwright was considered and rejected — it needs Better Auth
// cookies threaded through the WebSocket handshake, which bloats the runner
// config more than it helps.

async function openNoteAs(
  browser: Browser,
  user: UserCookie,
  url: string,
): Promise<{
  ctx: Awaited<ReturnType<Browser["newContext"]>>;
  page: Awaited<ReturnType<Awaited<ReturnType<Browser["newContext"]>>["newPage"]>>;
}> {
  const ctx = await browser.newContext();
  await applySessionCookieFor(ctx, user);
  const page = await ctx.newPage();
  await page.goto(url);
  return { ctx, page };
}

test.describe("Plan 2B collab E2E", () => {
  test("2 editors sync, viewer is readonly, comment round-trip", async ({
    browser,
    request,
  }) => {
    const seed = await seedMultiRoleAndSignIn(request);
    const noteUrl = `/ko/app/w/${seed.wsSlug}/p/${seed.projectId}/notes/${seed.noteId}`;

    // Three browser contexts — one per role user. commenter and viewer are
    // both readonly for the Yjs editor; commenter can still post comments.
    const a = await openNoteAs(browser, seed.editor, noteUrl);
    const b = await openNoteAs(browser, seed.commenter, noteUrl);
    const v = await openNoteAs(browser, seed.viewer, noteUrl);

    try {
      // 1. Wait for each Plate surface to mount. The commenter + viewer
      //    surfaces mount read-only but still render the `note-body` testid.
      await a.page.getByTestId("note-body").waitFor({ timeout: 15_000 });
      await b.page.getByTestId("note-body").waitFor({ timeout: 15_000 });
      await v.page.getByTestId("note-body").waitFor({ timeout: 15_000 });

      // 2. Editor types → commenter + viewer see the text via Hocuspocus.
      //    Plate empty state renders a placeholder, so focus + type is the
      //    only reliable way to land characters in the doc.
      await a.page.getByTestId("note-body").click();
      await a.page.keyboard.type("hello from editor A");

      // Propagation target: within 5s the remote DOM should contain the
      // typed string. Assertions use `toContainText` on the Plate surface
      // rather than the underlying Y.Doc so we verify the full round-trip
      // (keystroke → Y update → server broadcast → remote Plate render).
      await expect(b.page.getByTestId("note-body")).toContainText(
        "hello from editor A",
        { timeout: 5_000 },
      );
      await expect(v.page.getByTestId("note-body")).toContainText(
        "hello from editor A",
        { timeout: 5_000 },
      );

      // 3. Viewer + commenter see the readonly banner; editor does not.
      //    Banner copy lives in messages/ko/collab.json "readonly_banner".
      await expect(v.page.getByText("읽기 전용 모드입니다")).toBeVisible();
      await expect(b.page.getByText("읽기 전용 모드입니다")).toBeVisible();
      await expect(a.page.getByText("읽기 전용 모드입니다")).toHaveCount(0);

      // 4. Commenter posts a comment with an @mention of editor A. The
      //    CommentsPanel renders inside an <aside>; the page-level composer
      //    is the first <textarea> inside it (per-thread composers mount
      //    later, only when a thread is expanded).
      const composer = b.page.locator("aside textarea").first();
      await composer.waitFor({ timeout: 5_000 });
      await composer.fill(`LGTM @[user:${seed.editor.userId}]`);
      await b.page
        .getByRole("button", { name: /코멘트 추가|add comment/i })
        .first()
        .click();

      // 5. Editor A's TanStack Query invalidation (useCreateComment) should
      //    refetch /api/comments?noteId=... and the new comment renders.
      //    Use a generous timeout — polling interval is refetchOnWindowFocus
      //    defaults + the mutation's explicit invalidate.
      await expect(a.page.getByText("LGTM").first()).toBeVisible({
        timeout: 35_000,
      });
    } finally {
      await a.ctx.close();
      await b.ctx.close();
      await v.ctx.close();
    }
  });
});
