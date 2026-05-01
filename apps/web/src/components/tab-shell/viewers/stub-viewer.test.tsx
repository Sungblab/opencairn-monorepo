import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { StubViewer } from "./stub-viewer";

const messages = {
  appShell: {
    viewers: {
      stub: { unavailable: "{mode} 뷰어는 이 화면에서 사용할 수 없습니다." },
    },
  },
};

describe("StubViewer", () => {
  it("interpolates the mode name into the unavailable copy", () => {
    render(
      <NextIntlClientProvider locale="ko" messages={messages}>
        <StubViewer mode="whiteboard" />
      </NextIntlClientProvider>,
    );
    expect(
      screen.getByText("whiteboard 뷰어는 이 화면에서 사용할 수 없습니다."),
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
