import { test, expect } from "@playwright/test";
import {
  applySessionCookie,
  seedAndSignIn,
  type SeededSession,
} from "./helpers/seed-session";

// Smoke test for Deep Research Phase D. Mocks every /api/research/* endpoint
// so the flow runs deterministically without hitting Google. Mirrors the
// auth bootstrap pattern used by other (shell)-route specs.
//
// Phase D ships this spec but does NOT gate the PR on a green run. The dev
// server must boot with FEATURE_DEEP_RESEARCH=true for the page to mount;
// without that env, the route 404s by design (apps/api/src/routes/research.ts
// :52 + apps/web/src/lib/feature-flags.ts). Phase E owns the full E2E green
// matrix including the env wiring — this file is the contract.
test.describe("Deep Research smoke", () => {
  let session: SeededSession;

  test.beforeEach(async ({ context, request }) => {
    session = await seedAndSignIn(request);
    await applySessionCookie(context, session);
  });

  test.skip(
    process.env.FEATURE_DEEP_RESEARCH?.toLowerCase() !== "true",
    "FEATURE_DEEP_RESEARCH not set on dev server — Phase E will run this in CI",
  );

  test("submit topic → plan → approve → completed redirect", async ({
    page,
    context,
  }) => {
    // Mock listRuns: empty initially.
    await context.route("**/api/research/runs?workspaceId=*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ runs: [] }),
      });
    });

    // Mock createRun.
    await context.route("**/api/research/runs", async (route, request) => {
      if (request.method() !== "POST") return route.continue();
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ runId: "r-smoke" }),
      });
    });

    // Mock getRun: return awaiting_approval first, then completed on
    // subsequent invocations. Playwright keeps the route active across
    // the query refetchInterval ticks.
    let getCount = 0;
    await context.route("**/api/research/runs/r-smoke", async (route) => {
      getCount += 1;
      const status = getCount <= 1 ? "awaiting_approval" : "completed";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "r-smoke",
          workspaceId: session.workspaceId ?? "ws",
          projectId: session.projectId ?? "proj",
          topic: "Smoke topic",
          model: "deep-research-preview-04-2026",
          billingPath: "byok",
          status,
          currentInteractionId: null,
          approvedPlanText: status === "completed" ? "Plan body" : null,
          error: null,
          totalCostUsdCents: null,
          noteId: status === "completed" ? "n-smoke" : null,
          createdAt: "2026-04-25T00:00:00Z",
          updatedAt: "2026-04-25T00:00:00Z",
          completedAt: status === "completed" ? "2026-04-25T00:30:00Z" : null,
          turns: [
            {
              id: "t1",
              seq: 0,
              role: "agent",
              kind: "plan_proposal",
              interactionId: null,
              content: "1) Step\n2) Step",
              createdAt: "2026-04-25T00:00:00Z",
            },
          ],
          artifacts: [],
        }),
      });
    });

    // Mock approve.
    await context.route(
      "**/api/research/runs/r-smoke/approve",
      async (route) => {
        await route.fulfill({
          status: 202,
          contentType: "application/json",
          body: JSON.stringify({ approved: true }),
        });
      },
    );

    // Mock the SSE stream — empty body is fine; the query's refetchInterval
    // will pick up the second getRun response.
    await context.route(
      "**/api/research/runs/r-smoke/stream",
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "text/event-stream",
          body: "",
        });
      },
    );

    // Mock the eventual note read so the post-redirect page renders.
    await context.route("**/api/notes/n-smoke", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "n-smoke",
          projectId: session.projectId ?? "proj",
          workspaceId: session.workspaceId ?? "ws",
          folderId: null,
          inheritParent: false,
          title: "Smoke topic",
          content: [
            {
              type: "research-meta",
              runId: "r-smoke",
              model: "deep-research-preview-04-2026",
              plan: "Plan body",
              sources: [],
              children: [{ text: "" }],
            },
            { type: "p", children: [{ text: "Report body" }] },
          ],
          contentText: "Report body",
          type: "note",
          sourceType: null,
          sourceFileKey: null,
          sourceUrl: null,
          mimeType: null,
          isAuto: true,
          createdAt: "2026-04-25T00:30:00Z",
          updatedAt: "2026-04-25T00:30:00Z",
          deletedAt: null,
        }),
      });
    });

    await page.goto(`/ko/app/w/${session.wsSlug}/research`);
    await expect(page.getByText("Deep Research")).toBeVisible();
    await page.getByRole("button", { name: /새 리서치 시작/ }).click();
    await page.getByTestId("research-topic").fill("Smoke topic");
    // Project select — first non-empty option (the seeded fixture project).
    await page.locator("select").first().selectOption({ index: 1 });
    await page.getByRole("button", { name: /시작하기/ }).click();

    // Plan review screen.
    await expect(page.getByText(/조사 계획 검토/)).toBeVisible();
    await expect(page.getByText(/1\) Step/)).toBeVisible();

    await page.getByRole("button", { name: /승인하고 시작/ }).click();

    // After completion, we redirect to /n/n-smoke. Wait for that.
    await page.waitForURL(/\/n\/n-smoke/);
    await expect(page.getByText("Smoke topic")).toBeVisible();
  });
});
