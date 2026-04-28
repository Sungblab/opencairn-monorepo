import { test, expect } from "@playwright/test";
import { seedFullStackSession } from "./helpers/full-stack";
import { installMockEventSource } from "./helpers/sse-fixtures";

const WORKFLOW_ID = "wf-e2e-live-ingest";
const NOW = "2026-04-29T00:00:00.000Z";

test.describe("Live ingest visualization smoke", () => {
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
          delayMs: 3_000,
          event: {
            workflowId: WORKFLOW_ID,
            seq: 2,
            ts: NOW,
            kind: "stage_changed",
            payload: { stage: "parsing", pct: 25 },
          },
        },
        {
          delayMs: 3_500,
          event: {
            workflowId: WORKFLOW_ID,
            seq: 3,
            ts: NOW,
            kind: "unit_started",
            payload: { index: 1, total: 2, label: "page 1" },
          },
        },
        {
          delayMs: 4_000,
          event: {
            workflowId: WORKFLOW_ID,
            seq: 4,
            ts: NOW,
            kind: "outline_node",
            payload: {
              id: "intro",
              parentId: null,
              level: 1,
              title: "Introduction",
            },
          },
        },
      ],
    });

    await page.goto(`/ko/app/w/${session.wsSlug}/chat-scope`, {
      waitUntil: "domcontentloaded",
    });

    await expect(page.getByTestId("ingest-spotlight")).toBeVisible();
    await expect(page.getByTestId("ingest-dock")).toBeVisible();
    await expect(
      page.getByTestId("ingest-spotlight").getByText("fixture.pdf"),
    ).toBeVisible();

    await expect(page.getByTestId("ingest-spotlight")).toHaveCount(0, {
      timeout: 15_000,
    });

    await page.getByTestId("ingest-dock-card").click();
    await expect(page.getByText("Introduction")).toBeVisible();
    await expect(page.getByText("50%")).toBeVisible();
  });
});
