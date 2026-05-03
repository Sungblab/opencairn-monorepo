import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import JSZip from "jszip";
import { test, expect } from "@playwright/test";
import { applySessionCookie, seedAndSignIn } from "./helpers/seed-session";

// Full-stack smoke, mirroring import-notion.spec.ts. Requires Postgres,
// MinIO, Temporal, API, worker, and FEATURE_IMPORT_ENABLED=true. The ZIP shape
// is provider-agnostic Markdown: pages plus a relative attachment.
test.describe("markdown zip import end-to-end", () => {
  test.skip(
    process.env.FEATURE_IMPORT_ENABLED !== "true",
    "FEATURE_IMPORT_ENABLED not set — /import route is 404",
  );

  test("seeds -> uploads -> starts -> progress settles", async ({
    page,
    request,
    context,
  }) => {
    const session = await seedAndSignIn(request);
    await applySessionCookie(context, session);

    const zipDir = fs.mkdtempSync(path.join(os.tmpdir(), "markdown-e2e-"));
    const zipPath = path.join(zipDir, "markdown-import.zip");
    const zip = new JSZip();
    zip.file(
      "Index.md",
      "---\ntags:\n  - research\n---\n# Index\n\nSee [[Linked]].\n\n![Asset](assets/image.png)\n",
    );
    zip.file("Folder/Linked.md", "# Linked\n\nTarget page.\n");
    zip.file("assets/image.png", Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    fs.writeFileSync(zipPath, await zip.generateAsync({ type: "nodebuffer" }));

    try {
      await page.goto(`/ko/workspace/${session.wsSlug}/import`);
      await expect(
        page.getByRole("heading", { name: /가져오기|Import/ }),
      ).toBeVisible();

      await page.getByRole("tab", { name: /Markdown ZIP/ }).click();
      await page.setInputFiles("input[type=file]", zipPath);
      await expect(page.getByText(/업로드 완료|Uploaded/)).toBeVisible({
        timeout: 30_000,
      });

      await page.getByRole("button", { name: /가져오기 시작|Start import/ }).click();
      await expect(page).toHaveURL(/\/import\/jobs\//, { timeout: 10_000 });
      await expect(page.getByText(/완료되었습니다|Import complete/)).toBeVisible({
        timeout: 60_000,
      });
    } finally {
      fs.rm(zipDir, { recursive: true, force: true }, () => {
        /* best-effort */
      });
    }
  });
});
