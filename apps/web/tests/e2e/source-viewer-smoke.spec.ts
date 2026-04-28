import { test, expect } from "@playwright/test";
import { seedFullStackSession } from "./helpers/full-stack";

const PDF_NOTE_ID = "11111111-1111-4111-8111-111111111111";
const PDF_BYTES = Buffer.from(
  "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n" +
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n" +
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>\nendobj\n" +
    "trailer\n<< /Root 1 0 R >>\n%%EOF\n",
);

test.describe("Source PDF viewer smoke", () => {
  test("renders the source viewer chrome for a PDF tab", async ({
    page,
    context,
    request,
  }) => {
    const session = await seedFullStackSession(request, context);
    const tab = {
      id: "source-pdf-fixture",
      kind: "note",
      targetId: PDF_NOTE_ID,
      mode: "source",
      title: "Fixture PDF",
      pinned: false,
      preview: false,
      dirty: false,
      splitWith: null,
      splitSide: null,
      scrollY: 0,
    };

    await page.addInitScript(
      ({ wsSlug, tab }) => {
        localStorage.setItem(
          `oc:tabs:ws_slug:${wsSlug}`,
          JSON.stringify({
            tabs: [tab],
            activeId: tab.id,
            closedStack: [],
          }),
        );
      },
      { wsSlug: session.wsSlug, tab },
    );

    await page.route(`**/api/notes/${PDF_NOTE_ID}/file`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/pdf",
        headers: {
          "content-disposition": 'inline; filename="fixture.pdf"',
        },
        body: PDF_BYTES,
      });
    });

    await page.goto(`/ko/app/w/${session.wsSlug}/chat-scope`);

    await expect(page.getByTestId("source-viewer")).toBeVisible();
    await expect(
      page.getByTestId("source-viewer").getByText("Fixture PDF"),
    ).toBeVisible();
    await expect(page.getByLabel("새 탭에서 열기")).toHaveAttribute(
      "href",
      `/api/notes/${PDF_NOTE_ID}/file`,
    );
    await expect(page.getByLabel("다운로드")).toHaveAttribute(
      "download",
      "Fixture PDF",
    );
  });
});
