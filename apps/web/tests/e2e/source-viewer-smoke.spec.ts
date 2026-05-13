import { test, expect } from "@playwright/test";
import { seedFullStackSession } from "./helpers/full-stack";

const PDF_NOTE_ID = "11111111-1111-4111-8111-111111111111";
const PDF_BYTES = Buffer.from(
  "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n" +
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n" +
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 240 240] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n" +
    "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n" +
    "5 0 obj\n<< /Length 55 >>\nstream\nBT /F1 24 Tf 36 132 Td (Fixture PDF Visible) Tj ET\nendstream\nendobj\n" +
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

    await page.goto(`/ko/workspace/${session.wsSlug}/chat-scope`);

    await expect(page.getByTestId("source-viewer")).toBeVisible();
    await expect.poll(async () => {
      return page.locator("embedpdf-container").evaluate((host) => {
        const root = host.shadowRoot;
        if (!root) return false;
        return Array.from(root.querySelectorAll("div")).some((element) => {
          const rect = element.getBoundingClientRect();
          const style = element.getAttribute("style") ?? "";
          return (
            rect.width > 100 &&
            rect.height > 100 &&
            style.includes("background-color: rgb(255, 255, 255)")
          );
        });
      });
    }).toBe(true);
  });
});
