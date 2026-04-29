import type React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { SynthesisResult } from "../SynthesisResult";
import type { SynthesisStreamState } from "../../../hooks/use-synthesis-stream";
import messages from "../../../../messages/ko/synthesis-export.json";

function setup(
  state: SynthesisStreamState,
  runId = "run-1",
  onResynthesize = vi.fn(),
) {
  return render(
    <NextIntlClientProvider
      locale="ko"
      messages={{ synthesisExport: messages }}
    >
      <SynthesisResult
        runId={runId}
        state={state}
        onResynthesize={onResynthesize}
      />
    </NextIntlClientProvider>,
  );
}

const doneState: SynthesisStreamState = {
  status: "done",
  sourceCount: 5,
  tokensUsed: 1200,
  docUrl: "https://example.com/doc.md",
  format: "md",
  errorCode: null,
};

describe("SynthesisResult", () => {
  it("renders download anchor with correct href when done with format md", () => {
    setup(doneState);
    const anchor = screen.getByRole("link");
    expect(anchor.getAttribute("href")).toContain(
      "/api/synthesis-export/runs/run-1/document?format=md",
    );
  });

  it("returns null (no anchor) when status is not done", () => {
    setup({ ...doneState, status: "synthesizing" });
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("returns null (no anchor) when format is null", () => {
    setup({ ...doneState, format: null });
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("uses download.tex key for latex format", () => {
    setup({ ...doneState, format: "latex" });
    expect(screen.getByText(/\.tex 다운로드/)).toBeDefined();
  });
});
