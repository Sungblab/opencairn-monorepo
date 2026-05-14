import { expect, test } from "@playwright/test";
import { seedFullStackSession } from "./helpers/full-stack";
import { installMockEventSource } from "./helpers/sse-fixtures";

const WORKFLOW_ID = "wf-agentic-upload-smoke";
const ORIGINAL_FILE_ID = "00000000-0000-4000-8000-000000000071";
const SOURCE_NOTE_ID = "00000000-0000-4000-8000-000000000072";
const BUNDLE_NODE_ID = "00000000-0000-4000-8000-000000000073";
const NOW = "2026-05-15T00:00:00.000Z";

const PDF_BYTES = Buffer.from(
  "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n" +
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n" +
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 240 240] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n" +
    "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n" +
    "5 0 obj\n<< /Length 58 >>\nstream\nBT /F1 18 Tf 24 132 Td (Office converted PDF smoke) Tj ET\nendstream\nendobj\n" +
    "trailer\n<< /Root 1 0 R >>\n%%EOF\n",
);

test.describe("Agentic upload workflow smoke", () => {
  test("connects upload intent, ingest completion, workflow handoff, split view, and bottom dock", async ({
    page,
    context,
    request,
  }) => {
    test.setTimeout(120_000);
    const session = await seedFullStackSession(request, context);

    await installMockEventSource(page, {
      workflowId: WORKFLOW_ID,
      fileName: "source-brief.docx",
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      events: [
        {
          delayMs: 500,
          event: {
            workflowId: WORKFLOW_ID,
            seq: 1,
            ts: NOW,
            kind: "started",
            payload: {
              mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              fileName: "source-brief.docx",
              url: null,
              totalUnits: 1,
            },
          },
        },
        {
          delayMs: 300,
          event: {
            workflowId: WORKFLOW_ID,
            seq: 2,
            ts: NOW,
            kind: "bundle_status_changed",
            payload: {
              bundleNodeId: BUNDLE_NODE_ID,
              status: "completed",
            },
          },
        },
        {
          delayMs: 300,
          event: {
            workflowId: WORKFLOW_ID,
            seq: 3,
            ts: NOW,
            kind: "completed",
            payload: {
              noteId: SOURCE_NOTE_ID,
              totalDurationMs: 1100,
            },
          },
        },
      ],
    });

    await page.route("**/api/ingest/upload", async (route) => {
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({
          workflowId: WORKFLOW_ID,
          objectKey: "uploads/e2e/source-brief.docx",
          sourceBundleNodeId: BUNDLE_NODE_ID,
          originalFileId: ORIGINAL_FILE_ID,
        }),
      });
    });
    await page.route(`**/api/agent-files/${ORIGINAL_FILE_ID}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          file: {
            id: ORIGINAL_FILE_ID,
            workspaceId: session.workspaceId,
            projectId: session.projectId,
            folderId: null,
            title: "source-brief.docx",
            filename: "source-brief.docx",
            extension: "docx",
            kind: "docx",
            mimeType:
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            bytes: 2048,
            source: "manual",
            versionGroupId: "00000000-0000-4000-8000-000000000074",
            version: 1,
            ingestWorkflowId: WORKFLOW_ID,
            ingestStatus: "completed",
            sourceNoteId: SOURCE_NOTE_ID,
            canvasNoteId: null,
            compileStatus: "disabled",
            compiledMimeType: "application/pdf",
            createdAt: NOW,
            updatedAt: NOW,
          },
        }),
      });
    });
    await page.route(`**/api/agent-files/${ORIGINAL_FILE_ID}/compiled`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/pdf",
        headers: {
          "content-disposition": 'inline; filename="source-brief.pdf"',
        },
        body: PDF_BYTES,
      });
    });
    await page.route(`**/api/agent-files/${ORIGINAL_FILE_ID}/file`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        body: Buffer.from("docx fixture"),
      });
    });
    await page.route("**/api/integrations/google/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ connected: false }),
      });
    });
    await page.route(
      `**/api/projects/${session.projectId}/workflow-console/runs**`,
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            runs: [
              {
                runId: "run-upload-summary-smoke",
                runType: "document_generation",
                sourceId: WORKFLOW_ID,
                workspaceId: session.workspaceId,
                projectId: session.projectId,
                workGroupId: "wg-upload-summary-smoke",
                agentRole: "write",
                status: "completed",
                risk: "low",
                title: "Upload summary workflow",
                progress: null,
                cost: null,
                approvals: [],
                error: null,
                createdAt: NOW,
                updatedAt: NOW,
                completedAt: NOW,
                outputs: [],
              },
            ],
          }),
        });
      },
    );

    await page.goto(`/ko/workspace/${session.wsSlug}/project/${session.projectId}`, {
      waitUntil: "domcontentloaded",
    });
    await page.getByRole("button", { name: /업로드/ }).first().click();
    await page.locator('input[type="file"]').last().setInputFiles({
      name: "source-brief.docx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: Buffer.from("docx fixture"),
    });
    await page.getByTestId("upload-intent-summary").click();

    const uploadResponse = page.waitForResponse(
      (res) =>
        res.url().includes("/api/ingest/upload") &&
        res.request().method() === "POST",
    );
    await page.getByRole("button", { name: "업로드 시작" }).click();
    await expect((await uploadResponse).ok()).toBeTruthy();

    await expect(page.getByTestId("agent-file-viewer")).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByTestId("agent-file-pdf-viewer")).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText("요약하기")).toBeVisible({ timeout: 20_000 });

    await page.getByRole("button", { name: "원본을 오른쪽에 열기" }).click();
    await expect(page.getByTestId("split-pane-primary")).toBeVisible();
    await expect(page.getByTestId("split-pane-secondary")).toBeVisible();
    await expect(page.getByTestId("split-layout-toolbar")).toBeVisible();

    await page.getByRole("button", { name: "진행 중인 작업" }).click();
    await expect(page.getByTestId("workspace-bottom-dock")).toBeVisible();
    await expect(page.getByTestId("dock-workflow-runs")).toBeVisible();
  });
});
