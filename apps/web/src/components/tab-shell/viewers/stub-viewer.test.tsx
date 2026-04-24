import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { StubViewer } from "./stub-viewer";

const messages = {
  appShell: {
    viewers: { stub: { comingSoon: "{mode} 뷰어는 다음 Plan 에서 준비됩니다." } },
  },
};

describe("StubViewer", () => {
  it("interpolates the mode name into the coming-soon copy", () => {
    render(
      <NextIntlClientProvider locale="ko" messages={messages}>
        <StubViewer mode="whiteboard" />
      </NextIntlClientProvider>,
    );
    expect(
      screen.getByText("whiteboard 뷰어는 다음 Plan 에서 준비됩니다."),
    ).toBeInTheDocument();
  });

  it("renders a stable data-testid for shell dispatch tests", () => {
    render(
      <NextIntlClientProvider locale="ko" messages={messages}>
        <StubViewer mode="diff" />
      </NextIntlClientProvider>,
    );
    expect(screen.getByTestId("stub-viewer")).toBeInTheDocument();
  });
});
