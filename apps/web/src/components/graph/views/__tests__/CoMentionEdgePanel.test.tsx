import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import koGraph from "@/../messages/ko/graph.json";
import { CoMentionEdgePanel } from "../CoMentionEdgePanel";
import type { GroundedEdge } from "../../grounded-types";

function wrap(edge: GroundedEdge) {
  const onClose = vi.fn();
  render(
    <NextIntlClientProvider locale="ko" messages={{ graph: koGraph }}>
      <CoMentionEdgePanel edge={edge} onClose={onClose} />
    </NextIntlClientProvider>,
  );
  return { onClose };
}

describe("CoMentionEdgePanel", () => {
  it("explains display-only co-mention links and lists shared source notes", () => {
    wrap({
      id: "a->b:co-mention",
      sourceId: "11111111-1111-4111-8111-111111111111",
      targetId: "22222222-2222-4222-8222-222222222222",
      relationType: "co-mention",
      weight: 1,
      surfaceType: "co_mention",
      displayOnly: true,
      sourceNoteIds: ["33333333-3333-4333-8333-333333333333"],
    });

    expect(screen.getByTestId("co-mention-panel")).toBeInTheDocument();
    expect(screen.getByText(koGraph.coMention.title)).toBeInTheDocument();
    expect(screen.getByText("공유 출처 1개")).toBeInTheDocument();
    expect(
      screen.getByText("33333333-3333-4333-8333-333333333333"),
    ).toBeInTheDocument();
  });
});
