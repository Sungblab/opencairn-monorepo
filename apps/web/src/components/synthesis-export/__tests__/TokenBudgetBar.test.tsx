import type React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { TokenBudgetBar } from "../TokenBudgetBar";
import messages from "../../../../messages/ko/synthesis-export.json";

function setup(props: { used: number; budget: number }) {
  return render(
    <NextIntlClientProvider locale="ko" messages={{ synthesisExport: messages }}>
      <TokenBudgetBar {...props} />
    </NextIntlClientProvider>,
  );
}

describe("TokenBudgetBar", () => {
  it("does NOT render 예산 초과 text when within budget", () => {
    setup({ used: 5000, budget: 10000 });
    expect(screen.queryByText(/예산 초과/)).toBeNull();
  });

  it("renders 예산 초과 text when used exceeds budget", () => {
    setup({ used: 12000, budget: 10000 });
    expect(screen.getByText(/예산 초과/)).toBeDefined();
  });
});
