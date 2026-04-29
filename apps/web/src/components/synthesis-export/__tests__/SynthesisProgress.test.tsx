import type React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { SynthesisProgress } from "../SynthesisProgress";
import type { SynthesisStreamState } from "../../../hooks/use-synthesis-stream";
import messages from "../../../../messages/ko/synthesis-export.json";

function setup(state: SynthesisStreamState) {
  return render(
    <NextIntlClientProvider
      locale="ko"
      messages={{ synthesisExport: messages }}
    >
      <SynthesisProgress state={state} />
    </NextIntlClientProvider>,
  );
}

const baseState: SynthesisStreamState = {
  status: "synthesizing",
  sourceCount: 0,
  tokensUsed: 0,
  docUrl: null,
  format: null,
  errorCode: null,
};

describe("SynthesisProgress", () => {
  it("renders Korean status label '합성 중' when status is synthesizing", () => {
    setup(baseState);
    expect(screen.getByText(/합성 중/)).toBeDefined();
  });

  it("renders '소스 수집 중' and source count when status is fetching", () => {
    setup({ ...baseState, status: "fetching", sourceCount: 3 });
    expect(screen.getByText(/소스 수집 중 · 3/)).toBeDefined();
  });

  it("renders '완료' when status is done", () => {
    setup({ ...baseState, status: "done" });
    expect(screen.getByText(/완료/)).toBeDefined();
  });
});
