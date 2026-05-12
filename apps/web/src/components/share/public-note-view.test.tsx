import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";

import { PublicNoteView } from "./public-note-view";

const messages = {
  publicShare: {
    viewOnly: "보기 전용",
    sharedBy: "OpenCairn에서 공유된 페이지",
    signInCta: "OpenCairn 시작하기",
    notFound: "이 링크는 만료되었거나 폐기되었습니다",
  },
};

function renderPublicNoteView() {
  return render(
    <NextIntlClientProvider locale="ko" messages={messages}>
      <PublicNoteView
        note={{
          title: "공유 테스트",
          plateValue: [
            { type: "p", children: [{ text: "본문" }] },
            {
              type: "code_block",
              language: "bash",
              children: [
                { type: "code_line", children: [{ text: "pnpm test" }] },
              ],
            },
          ],
        } as never}
      />
    </NextIntlClientProvider>,
  );
}

describe("PublicNoteView", () => {
  it("renders a reader-style shared page without editor chrome", () => {
    renderPublicNoteView();

    expect(screen.getByTestId("public-share-reader")).toBeInTheDocument();
    expect(screen.getByTestId("public-share-article")).toHaveClass("max-w-3xl");
    expect(
      screen.getByRole("heading", { level: 1, name: "공유 테스트" }),
    ).toBeInTheDocument();
    expect(screen.getByText("OpenCairn에서 공유된 페이지")).toBeInTheDocument();
    expect(screen.queryByTestId("app-shell-sidebar")).not.toBeInTheDocument();
    expect(screen.queryByTestId("note-actions")).not.toBeInTheDocument();
    expect(screen.getByTestId("static-code-block")).toBeInTheDocument();
  });
});
