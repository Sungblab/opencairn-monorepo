import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import JSZip from "jszip";
import { test, expect } from "@playwright/test";
import { applySessionCookie, seedAndSignIn } from "./helpers/seed-session";

// Full-stack integration. Requires:
//   - Postgres, MinIO, Temporal (docker-compose up -d)
//   - API on :4000 with INTERNAL_API_SECRET + INTEGRATION_TOKEN_ENCRYPTION_KEY
//   - Worker running (pnpm --filter @opencairn/worker dev)
//   - Web on :3000 with FEATURE_IMPORT_ENABLED=true
//
// If the flag isn't set we skip — the /import route 404s and the test would
// fail for the wrong reason (the flag, not the import logic).
test.describe("notion zip import end-to-end", () => {
  test.skip(
    process.env.FEATURE_IMPORT_ENABLED !== "true",
    "FEATURE_IMPORT_ENABLED not set — /import route is 404",
  );

  test("seeds → uploads → starts → progress settles", async ({
    page,
    request,
    context,
  }) => {
    const session = await seedAndSignIn(request);
    await applySessionCookie(context, session);

    // Build a fresh Notion-like fixture ZIP in a per-test mkdtemp directory.
    // We don't ship a committed binary — rebuilding per run keeps the shape
    // obvious and avoids diffing opaque zip bytes in reviews. `mkdtempSync`
    // gives us an unpredictable directory name (CodeQL js/insecure-temporary-file
    // — `Date.now()` would let a co-tenant on the runner pre-create the path).
    const zipDir = fs.mkdtempSync(path.join(os.tmpdir(), "notion-e2e-"));
    const zipPath = path.join(zipDir, "import.zip");
    const ROOT_ID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const CHILD_ID = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const zip = new JSZip();
    zip.file(
      `My Workspace ${ROOT_ID}.md`,
      "# My Workspace\n\nWelcome.\n",
    );
    zip.file(
      `My Workspace ${ROOT_ID}/Child Page ${CHILD_ID}.md`,
      "# Child Page\n\nSome text.\n",
    );
    const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
    fs.writeFileSync(zipPath, zipBuffer);

    try {
      await page.goto(`/ko/workspace/${session.wsSlug}/import`);
      await expect(
        page.getByRole("heading", { name: /가져오기|Import/ }),
      ).toBeVisible();

      // Notion ZIP is a compatibility path under More; Markdown ZIP is the
      // primary file-based import surface.
      await page.getByRole("tab", { name: /More|기타/ }).click();

      await page.setInputFiles("input[type=file]", zipPath);

      // Presigned URL round-trip + PUT to MinIO finishes within ~10s for the
      // tiny fixture. Give 30s headroom for a cold dev-box startup.
      await expect(page.getByText(/업로드 완료|Uploaded/)).toBeVisible({
        timeout: 30_000,
      });

      await page.getByRole("button", { name: /가져오기 시작|Start import/ }).click();
      await expect(page).toHaveURL(/\/import\/jobs\//, { timeout: 10_000 });

      // Full import with 2 pages + 0 binaries finishes in <30s normally;
      // 60s covers the Temporal activity retry budget.
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
