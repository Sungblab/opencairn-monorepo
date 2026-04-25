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
// expects more, so cast at the test boundary.
function renderMeta(
  el: ResearchMetaElementType = baseElement,
) {
  return render(
    withIntl(
      <ResearchMetaElement
        attributes={{ "data-slate-node": "element", ref: vi.fn() } as never}
        element={el}
      >
        {""}
      </ResearchMetaElement>,
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

