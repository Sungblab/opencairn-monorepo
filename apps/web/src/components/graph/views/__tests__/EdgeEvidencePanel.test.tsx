import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import koGraph from "@/../messages/ko/graph.json";
import { EdgeEvidencePanel } from "../EdgeEvidencePanel";

describe("EdgeEvidencePanel", () => {
  it("renders support status and evidence entries for a selected edge", () => {
    render(
      <NextIntlClientProvider locale="ko" messages={{ graph: koGraph }}>
        <EdgeEvidencePanel
          edge={{
            id: "66666666-6666-4666-8666-666666666666",
            sourceId: "11111111-1111-4111-8111-111111111111",
            targetId: "22222222-2222-4222-8222-222222222222",
            relationType: "supports",
            weight: 0.8,
            support: {
              claimId: "77777777-7777-4777-8777-777777777777",
              evidenceBundleId: "33333333-3333-4333-8333-333333333333",
              supportScore: 0.72,
              citationCount: 1,
              status: "supported",
            },
          }}
          bundle={{
            id: "33333333-3333-4333-8333-333333333333",
            workspaceId: "44444444-4444-4444-8444-444444444444",
            projectId: "55555555-5555-4555-8555-555555555555",
            purpose: "kg_edge",
            producer: { kind: "worker" },
            createdBy: null,
            createdAt: "2026-05-01T00:00:00.000Z",
            entries: [
              {
                noteChunkId: "88888888-8888-4888-8888-888888888888",
                noteId: "99999999-9999-4999-8999-999999999999",
                noteType: "source",
                sourceType: "pdf",
                headingPath: "Methods",
                sourceOffsets: { start: 10, end: 40 },
                score: 0.9,
                rank: 1,
                retrievalChannel: "vector",
                quote: "The method supports the relation.",
                citation: { label: "S1", title: "Source Note" },
                metadata: {},
              },
            ],
          }}
          onClose={() => undefined}
        />
      </NextIntlClientProvider>,
    );

    expect(screen.getByText(koGraph.evidence.title)).toBeInTheDocument();
    expect(screen.getByText(koGraph.evidence.status.supported)).toBeInTheDocument();
    expect(screen.getByText("Source Note")).toBeInTheDocument();
    expect(screen.getByText("The method supports the relation.")).toBeInTheDocument();
  });
});
