import { test, expect, type Page } from "@playwright/test";
import {
  applySessionCookie,
  seedAndSignIn,
  type SeededSession,
} from "./helpers/seed-session";

const rootId = "11111111-1111-4111-8111-111111111111";
const childId = "22222222-2222-4222-8222-222222222222";
const edgeId = "33333333-3333-4333-8333-333333333333";
const edgeBundleId = "44444444-4444-4444-8444-444444444444";
const cardBundleId = "55555555-5555-4555-8555-555555555555";
const sourceNoteId = "66666666-6666-4666-8666-666666666666";

function evidenceEntry({
  rank,
  title,
  label,
  quote,
}: {
  rank: number;
  title: string;
  label: string;
  quote: string;
}) {
  return {
    noteChunkId: `77777777-7777-4777-8777-77777777777${rank}`,
    noteId: sourceNoteId,
    noteType: "source",
    sourceType: "markdown",
    headingPath: "Research / Grounded Evidence",
    sourceOffsets: { start: rank * 10, end: rank * 10 + 6 },
    score: 0.91 - rank * 0.04,
    rank,
    retrievalChannel: "graph",
    quote,
    citation: { label, title, locator: `p.${rank}` },
    metadata: {},
  };
}

function groundedSurface(view: string | null, root: string | null) {
  const cardEntry = evidenceEntry({
    rank: 1,
    title: "Card source summary",
    label: "C1",
    quote: "Cards should show grounded citation summaries from seeded evidence.",
  });
  const edgeEntries = [
    evidenceEntry({
      rank: 1,
      title: "Graph edge source",
      label: "G1",
      quote: "Graph evidence links Alpha to Beta through a supported claim.",
    }),
    evidenceEntry({
      rank: 2,
      title: "Mindmap edge source",
      label: "M2",
      quote: "Mindmap evidence reuses the same bundle in browser rendering.",
    }),
  ];

  return {
    viewType: view ?? "graph",
    layout: view === "mindmap" ? "dagre" : "fcose",
    rootId: root ?? null,
    nodes: [
      {
        id: rootId,
        name: "Grounded Alpha",
        description: "Seeded evidence root concept",
        degree: 1,
        noteCount: 1,
        firstNoteId: sourceNoteId,
      },
      {
        id: childId,
        name: "Grounded Beta",
        description: "Seeded evidence child concept",
        degree: 1,
        noteCount: 1,
        firstNoteId: sourceNoteId,
      },
    ],
    edges:
      view === "cards"
        ? []
        : [
            {
              id: edgeId,
              sourceId: rootId,
              targetId: childId,
              relationType: "supports",
              weight: 0.82,
              support: {
                status: view === "mindmap" ? "weak" : "supported",
                supportScore: view === "mindmap" ? 0.42 : 0.87,
                citationCount: edgeEntries.length,
                evidenceBundleId: edgeBundleId,
                claimId: "88888888-8888-4888-8888-888888888888",
              },
            },
          ],
    cards: [
      {
        conceptId: rootId,
        title: "Grounded Alpha Card",
        summary: "Card-level summary backed by a seeded bundle.",
        citationCount: 1,
        evidenceBundleId: cardBundleId,
      },
      {
        conceptId: childId,
        title: "Grounded Beta Card",
        summary: "Card without bundle still renders next to evidence-backed cards.",
        citationCount: 0,
        evidenceBundleId: null,
      },
    ],
    evidenceBundles: [
      {
        id: edgeBundleId,
        workspaceId: "00000000-0000-4000-8000-000000000002",
        projectId: "00000000-0000-4000-8000-000000000003",
        purpose: "kg_edge",
        producer: { kind: "worker", runId: "e2e-grounded-edge" },
        query: "Grounded Alpha supports Grounded Beta",
        entries: edgeEntries,
        createdBy: null,
        createdAt: "2026-05-01T00:00:00.000Z",
      },
      {
        id: cardBundleId,
        workspaceId: "00000000-0000-4000-8000-000000000002",
        projectId: "00000000-0000-4000-8000-000000000003",
        purpose: "card_summary",
        producer: { kind: "api", runId: "e2e-grounded-card" },
        query: "Grounded Alpha card summary",
        entries: [cardEntry],
        createdBy: null,
        createdAt: "2026-05-01T00:01:00.000Z",
      },
    ],
    truncated: false,
    totalConcepts: 2,
  };
}

async function routeGroundedEvidence(page: Page, session: SeededSession) {
  await page.route(
    `**/api/projects/${session.projectId}/knowledge-surface**`,
    async (route) => {
      const url = new URL(route.request().url());
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          groundedSurface(
            url.searchParams.get("view"),
            url.searchParams.get("root"),
          ),
        ),
      });
    },
  );
}

test.describe("Grounded evidence browser surfaces", () => {
  test.describe.configure({ timeout: 60_000 });

  let session: SeededSession;

  test.beforeEach(async ({ context, page, request }) => {
    session = await seedAndSignIn(request);
    await applySessionCookie(context, session);
    await routeGroundedEvidence(page, session);
  });

  test("graph renders seeded edge evidence detail and citation summary", async ({
    page,
  }) => {
    await page.goto(
      `/ko/workspace/${session.wsSlug}/project/${session.projectId}/graph?view=graph&edge=${edgeId}`,
      { waitUntil: "domcontentloaded" },
    );
    await expect(page.getByTestId("project-graph-viewer")).toBeVisible({
      timeout: 15_000,
    });

    const panel = page.getByTestId("edge-evidence-panel");
    await expect(panel).toBeVisible({ timeout: 30_000 });
    await expect(panel).toContainText("관계 근거");
    await expect(panel).toContainText("근거 있음");
    await expect(panel).toContainText("지지도 87%");
    await expect(panel).toContainText("근거 2개");
    await expect(panel).toContainText(edgeBundleId);
    await expect(panel).toContainText("Graph edge source");
    await expect(panel).toContainText("G1");
    await expect(panel).toContainText(
      "Graph evidence links Alpha to Beta through a supported claim.",
    );
  });

  test("mindmap renders seeded weak evidence detail and citation summary", async ({
    page,
  }) => {
    await page.goto(
      `/ko/workspace/${session.wsSlug}/project/${session.projectId}/graph?view=mindmap&root=${rootId}&edge=${edgeId}`,
      { waitUntil: "domcontentloaded" },
    );
    await expect(page.getByTestId("project-graph-viewer")).toBeVisible({
      timeout: 15_000,
    });

    const panel = page.getByTestId("edge-evidence-panel");
    await expect(panel).toBeVisible({ timeout: 30_000 });
    await expect(panel).toContainText("관계 근거");
    await expect(panel).toContainText("근거 약함");
    await expect(panel).toContainText("지지도 42%");
    await expect(panel).toContainText("근거 2개");
    await expect(panel).toContainText("Mindmap edge source");
    await expect(panel).toContainText("M2");
  });

  test("cards render seeded evidence status, bundle id, and source summary", async ({
    page,
  }) => {
    await page.goto(
      `/ko/workspace/${session.wsSlug}/project/${session.projectId}/graph?view=cards`,
      { waitUntil: "domcontentloaded" },
    );

    await expect(page.getByText("Grounded Alpha Card")).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByText("Card-level summary backed by a seeded bundle."),
    ).toBeVisible();
    await expect(page.getByText("근거 1개")).toBeVisible();
    await expect(page.getByText(cardBundleId.slice(0, 8))).toBeVisible();

    await page.getByText("근거 보기").click();
    await expect(page.getByText("Card source summary")).toBeVisible();
    await expect(
      page.getByText(
        "Cards should show grounded citation summaries from seeded evidence.",
      ),
    ).toBeVisible();
  });
});
