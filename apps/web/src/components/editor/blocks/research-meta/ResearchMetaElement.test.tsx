import type React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { ResearchMetaElement } from "./ResearchMetaElement";
import type { ResearchMetaElement as ResearchMetaElementType } from "./research-meta-types";

// Use real next-intl messages (not a mock) so the test catches missing keys.
import koMessages from "../../../../../messages/ko/research.json";

const baseElement: ResearchMetaElementType = {
  type: "research-meta",
  runId: "r1",
  model: "deep-research-preview-04-2026",
  plan: "1) Search\n2) Synthesize",
  sources: [
    { title: "OpenAI", url: "https://openai.com", seq: 0 },
    { title: "Google", url: "https://google.com", seq: 1 },
  ],
  thoughtSummaries: ["Reasoning A", "Reasoning B"],
  costUsdCents: 230,
  children: [{ text: "" }],
};

function withIntl(node: React.ReactNode) {
  return (
    <NextIntlClientProvider locale="ko" messages={{ research: koMessages }}>
      {node}
    </NextIntlClientProvider>
  );
}

// Plate provides `attributes` / `nodeProps` props at runtime. For unit
// rendering we hand-roll a minimal subset — Plate's PlateElementProps
// expects api/setOptions/tf/type and friends that have no test value here.
// Cast the component to a relaxed prop shape at the test boundary.
const ResearchMetaElementForTest =
  ResearchMetaElement as unknown as React.ComponentType<{
    attributes: Record<string, unknown>;
    element: ResearchMetaElementType;
    children: React.ReactNode;
  }>;

function renderMeta(
  el: ResearchMetaElementType = baseElement,
) {
  return render(
    withIntl(
      <ResearchMetaElementForTest
        attributes={{ "data-slate-node": "element", ref: vi.fn() }}
        element={el}
      >
        {""}
      </ResearchMetaElementForTest>,
    ),
  );
}

describe("ResearchMetaElement", () => {
  it("renders the label", () => {
    renderMeta();
    expect(screen.getByText("Deep Research 메타데이터")).toBeInTheDocument();
  });

  it("starts collapsed (plan / sources hidden)", () => {
    renderMeta();
    expect(screen.queryByText("1) Search")).not.toBeInTheDocument();
  });

  it("expands on toggle click", () => {
    renderMeta();
    fireEvent.click(screen.getByRole("button", { name: /펼치기/ }));
    expect(screen.getByText(/1\) Search/)).toBeInTheDocument();
    expect(screen.getByText("OpenAI")).toBeInTheDocument();
    expect(screen.getByText("Google")).toBeInTheDocument();
  });

  it("renders cost when present", () => {
    renderMeta();
    fireEvent.click(screen.getByRole("button", { name: /펼치기/ }));
    // 230 cents -> $2.30
    expect(screen.getByText(/\$2\.30/)).toBeInTheDocument();
  });

  it("omits cost block when undefined", () => {
    renderMeta({ ...baseElement, costUsdCents: undefined });
    fireEvent.click(screen.getByRole("button", { name: /펼치기/ }));
    expect(screen.queryByText(/추정 비용/)).not.toBeInTheDocument();
  });

  it("omits thought summaries when missing", () => {
    renderMeta({ ...baseElement, thoughtSummaries: undefined });
    fireEvent.click(screen.getByRole("button", { name: /펼치기/ }));
    expect(screen.queryByText(/사고 요약/)).not.toBeInTheDocument();
  });
});

import * as Y from "yjs";
import {
  slateNodesToInsertDelta,
  yTextToSlateElement,
} from "@slate-yjs/core";

describe("ResearchMetaElement — Yjs serialization", () => {
  // Same canonical key apps/hocuspocus and the Plate Yjs plugin agree on.
  // See docs/contributing/llm-antipatterns.md §11.
  const ROOT_KEY = "content";

  it("survives a round-trip through Yjs", () => {
    const original: ResearchMetaElementType = {
      type: "research-meta",
      runId: "r1",
      model: "deep-research-max-preview-04-2026",
      plan: "Step 1\nStep 2",
      sources: [
        { title: "S1", url: "https://example.com/1", seq: 0 },
        { title: "S2", url: "https://example.com/2", seq: 1 },
      ],
      thoughtSummaries: ["t1", "t2"],
      costUsdCents: 500,
      children: [{ text: "" }],
    };

    // Wrap in a paragraph + meta block — y-slate root must contain at least
    // one block; the Plate ↔ Yjs bridge then serializes each child as a
    // sub-XmlText.
    const slateRoot = [original];

    const ydoc = new Y.Doc();
    const ytext = ydoc.get(ROOT_KEY, Y.XmlText) as Y.XmlText;
    ytext.applyDelta(slateNodesToInsertDelta(slateRoot));

    const restored = yTextToSlateElement(ytext);
    expect(restored.children).toHaveLength(1);
    const restoredMeta = restored.children[0] as ResearchMetaElementType;
    expect(restoredMeta.type).toBe("research-meta");
    expect(restoredMeta.runId).toBe("r1");
    expect(restoredMeta.model).toBe("deep-research-max-preview-04-2026");
    expect(restoredMeta.plan).toBe("Step 1\nStep 2");
    expect(restoredMeta.sources).toEqual(original.sources);
    expect(restoredMeta.thoughtSummaries).toEqual(["t1", "t2"]);
    expect(restoredMeta.costUsdCents).toBe(500);
  });

  it("survives round-trip when optional fields are absent", () => {
    const original: ResearchMetaElementType = {
      type: "research-meta",
      runId: "r2",
      model: "deep-research-preview-04-2026",
      plan: "p",
      sources: [],
      children: [{ text: "" }],
    };
    const ydoc = new Y.Doc();
    const ytext = ydoc.get("content", Y.XmlText) as Y.XmlText;
    ytext.applyDelta(slateNodesToInsertDelta([original]));
    const restored = yTextToSlateElement(ytext);
    const restoredMeta = restored.children[0] as ResearchMetaElementType;
    expect(restoredMeta.thoughtSummaries).toBeUndefined();
    expect(restoredMeta.costUsdCents).toBeUndefined();
    expect(restoredMeta.sources).toEqual([]);
  });
});

