import { test, expect } from "@playwright/test";
import { seedFullStackSession } from "./helpers/full-stack";
import { installMockEventSource } from "./helpers/sse-fixtures";

const WORKFLOW_ID = "wf-e2e-live-ingest";
const NOW = "2026-04-29T00:00:00.000Z";

test.describe("Background ingest notification smoke", () => {
  test.setTimeout(60_000);

  test("renders persisted run state and consumes mocked SSE progress", async ({
    page,
    context,
    request,
  }) => {
    const session = await seedFullStackSession(request, context);
    await installMockEventSource(page, {
      workflowId: WORKFLOW_ID,
      fileName: "fixture.pdf",
      mime: "application/pdf",
      events: [
        {
          delayMs: 2_500,
          event: {
            workflowId: WORKFLOW_ID,
            seq: 1,
            ts: NOW,
            kind: "started",
            payload: {
              mime: "application/pdf",
              fileName: "fixture.pdf",
              url: null,
              totalUnits: 2,
            },
          },
        },
        {
          delayMs: 500,
          event: {
            workflowId: WORKFLOW_ID,
            seq: 2,
            ts: NOW,
            kind: "completed",
            payload: {
              noteId: "00000000-0000-0000-0000-000000000001",
              totalDurationMs: 1000,
            },
          },
        },
      ],
    });

    await page.goto(`/ko/workspace/${session.wsSlug}/chat-scope`, {
      waitUntil: "domcontentloaded",
    });

    await expect(page.getByTestId("ingest-spotlight")).toHaveCount(0);
    await expect(page.getByTestId("ingest-dock")).toHaveCount(0);
    await expect(
      page.getByText("분석이 완료되었습니다. 생성된 노트를 확인해보세요."),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "확인하기" })).toBeVisible();
  });
});
