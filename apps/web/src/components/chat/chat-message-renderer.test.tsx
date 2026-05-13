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
    // Use expression form so escape sequences are processed; JSX string
    // attributes pass `\n` through as a literal two-char sequence.
    const md = "```js\nconst x = 1;\n```";
    render(wrap(<ChatMessageRenderer body={md} />));
    expect(screen.getByTestId("code-block-lang")).toHaveTextContent("js");
  });

  it("preserves literal escape sequences inside code blocks (no \\n stripping)", () => {
    // A regex tutorial that intentionally contains the two-character sequence
    // \\n must not be turned into a real newline by the renderer.
    const md = "```\nmatch /a\\nb/\n```";
    const { container } = render(wrap(<ChatMessageRenderer body={md} />));
    expect(container.textContent).toContain("match /a\\nb/");
  });

  it("formats valid JSON code blocks before rendering", () => {
    const md = '```json\n{"b":2,"a":{"nested":true}}\n```';
    const { container } = render(wrap(<ChatMessageRenderer body={md} />));

    expect(screen.getByTestId("code-block-lang")).toHaveTextContent("json");
    expect(screen.getByTestId("json-code-viewer")).toBeInTheDocument();
    expect(container.textContent).toContain('"b": 2');
    expect(container.textContent).toContain('"nested": true');
  });

  it("falls back to raw text for incomplete JSON while streaming", () => {
    const md = '```json\n{"b":';
    const { container } = render(wrap(<ChatMessageRenderer body={md} streaming />));

    expect(container.textContent).toContain('{"b":');
    expect(screen.getByTestId("streaming-cursor")).toBeInTheDocument();
  });

  it("renders a GFM table", () => {
    const md = "| a | b |\n|---|---|\n| 1 | 2 |";
    render(wrap(<ChatMessageRenderer body={md} />));
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("renders markdown images as bounded previews", () => {
    render(
      wrap(
        <ChatMessageRenderer body="![Generated diagram](/api/agent-files/file-1/file)" />,
      ),
    );

    expect(screen.getByRole("img", { name: "Generated diagram" })).toHaveClass(
      "max-h-80",
    );
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

  it("uses the compact prose variant when requested", () => {
    render(wrap(<ChatMessageRenderer body="작은 패널 답변" compact />));
    expect(screen.getByTestId("chat-message-renderer")).toHaveClass("text-[13px]");
  });
});

describe("ChatMessageRenderer — callout-aware blockquote", () => {
  it("renders > [!info] as a styled callout", () => {
    render(wrap(<ChatMessageRenderer body="> [!info] hello" />));
    const el = screen.getByTestId("chat-callout-info");
    expect(el).toBeInTheDocument();
    expect(el).toHaveTextContent("hello");
  });

  it("renders > [!warn] with warn styling", () => {
    render(wrap(<ChatMessageRenderer body="> [!warn] careful" />));
    expect(screen.getByTestId("chat-callout-warn")).toBeInTheDocument();
  });

  it("falls back to a plain blockquote without [!kind] prefix", () => {
    const { container } = render(wrap(<ChatMessageRenderer body="> just a quote" />));
    expect(container.querySelector("blockquote")).toBeInTheDocument();
    expect(screen.queryByTestId("chat-callout-info")).toBeNull();
  });
});
