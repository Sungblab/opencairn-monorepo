import { test, expect } from "@playwright/test";
import { seedFullStackSession } from "./helpers/full-stack";

test.skip(
  process.env.OPENCAIRN_E2E_LIVE_UPLOAD !== "1",
  "Set OPENCAIRN_E2E_LIVE_UPLOAD=1 to run this against the real Docker stack.",
);

function makePdf(text: string): Buffer {
  const safe = text.replace(/[\\()]/g, (ch) => `\\${ch}`);
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n",
    "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
    `5 0 obj\n<< /Length ${safe.length + 38} >>\nstream\nBT /F1 18 Tf 72 720 Td (${safe}) Tj ET\nendstream\nendobj\n`,
  ];
  let output = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(output, "latin1"));
    output += object;
  }
  const xrefOffset = Buffer.byteLength(output, "latin1");
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i += 1) {
    output += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(output, "latin1");
}

test.describe("Live PDF upload against Docker", () => {
  test("opens the original PDF tab first and reports completion by toast", async ({
    page,
    context,
    request,
  }) => {
    test.setTimeout(300_000);
    const session = await seedFullStackSession(request, context);

    await page.goto(`/ko/workspace/${session.wsSlug}/chat-scope`, {
      waitUntil: "domcontentloaded",
    });
    await page.getByRole("button", { name: "E2E Project" }).click();
    const uploadButton = page.getByRole("button", { name: /업로드/ }).first();
    await expect(uploadButton).toBeVisible({
      timeout: 30_000,
    });
    await uploadButton.click();
    await page.locator('input[type="file"]').last().setInputFiles({
      name: "live-ingest-smoke.pdf",
      mimeType: "application/pdf",
      buffer: makePdf(
        "OpenCairn live ingest smoke test PDF. The uploaded PDF should open first.",
      ),
    });

    const [uploadResponse] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.url().includes("/api/ingest/upload") &&
          res.request().method() === "POST",
        { timeout: 60_000 },
      ),
      page.getByRole("button", { name: "업로드 시작" }).click(),
    ]);
    const uploadBody = (await uploadResponse.json()) as {
      workflowId: string;
      originalFileId: string | null;
    };
    expect(uploadResponse.ok(), JSON.stringify(uploadBody)).toBe(true);
    expect(uploadBody.originalFileId).toBeTruthy();

    await expect(page.getByTestId("agent-file-viewer")).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByTestId("agent-file-pdf-viewer")).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByTestId("ingest-spotlight")).toHaveCount(0);
    await expect(page.getByTestId("ingest-dock")).toHaveCount(0);

    const tabState = await page.evaluate(
      (wsSlug) =>
        JSON.parse(localStorage.getItem(`oc:tabs:ws_slug:${wsSlug}`) || "{}"),
      session.wsSlug,
    );
    const active = (tabState.tabs || []).find(
      (tab: { id: string }) => tab.id === tabState.activeId,
    );
    expect(active).toMatchObject({
      kind: "agent_file",
      targetId: uploadBody.originalFileId,
    });
    expect(
      (tabState.tabs || []).some((tab: { kind: string }) => tab.kind === "ingest"),
    ).toBe(false);

    const terminalToast = page.getByText(/분석이 완료되었습니다|분석에 실패했습니다/).first();
    await expect(terminalToast).toBeVisible({ timeout: 240_000 });
    await expect(terminalToast).not.toContainText("실패");
    await expect(page.getByRole("button", { name: "확인하기" })).toBeVisible();

    console.log(
      JSON.stringify({
        workflowId: uploadBody.workflowId,
        originalFileId: uploadBody.originalFileId,
        activeTab: active,
      }),
    );
  });
});
