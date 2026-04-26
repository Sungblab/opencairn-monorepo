import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import koMessages from "@/../messages/ko/chat.json";
import { ChatMessageRenderer } from "./chat-message-renderer";

const wrap = (ui: React.ReactNode) => (
  <NextIntlClientProvider locale="ko" messages={{ chat: koMessages }}>
    {ui}
  </NextIntlClientProvider>
);

describe("ChatMessageRenderer", () => {
  it("renders a heading", () => {
    render(wrap(<ChatMessageRenderer body="# Hello" />));
    expect(screen.getByRole("heading", { name: "Hello" })).toBeInTheDocument();
  });

  it("renders a fenced code block with language label", () => {
    render(wrap(<ChatMessageRenderer body="```js\nconst x = 1;\n```" />));
    expect(screen.getByTestId("code-block-lang")).toHaveTextContent("js");
  });

  it("renders a GFM table", () => {
    const md = "| a | b |\n|---|---|\n| 1 | 2 |";
    render(wrap(<ChatMessageRenderer body={md} />));
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("strips a <script> tag from raw HTML", () => {
    const md = "<script>alert(1)</script>safe";
    const { container } = render(wrap(<ChatMessageRenderer body={md} />));
    expect(container.innerHTML).not.toContain("<script>");
    expect(container.textContent).toContain("safe");
  });

  it("renders a streaming cursor when streaming=true", () => {
    render(wrap(<ChatMessageRenderer body="hi" streaming />));
    expect(screen.getByTestId("streaming-cursor")).toBeInTheDocument();
  });
});
