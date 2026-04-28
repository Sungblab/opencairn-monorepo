import type React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { InlineDiffSheet } from "./inline-diff-sheet";
import koMessages from "../../../../messages/ko/doc-editor.json";
import enMessages from "../../../../messages/en/doc-editor.json";

function withIntl(node: React.ReactNode, locale: "ko" | "en" = "en") {
  const messages = locale === "ko" ? koMessages : enMessages;
  return (
    <NextIntlClientProvider locale={locale} messages={{ docEditor: messages }}>
      {node}
    </NextIntlClientProvider>
  );
}

const sampleHunk = {
  blockId: "b1",
  originalRange: { start: 0, end: 5 },
  originalText: "hello",
  replacementText: "Hi",
};

describe("InlineDiffSheet", () => {
  it("renders summary + per-hunk preview when ready", () => {
    render(
      withIntl(
        <InlineDiffSheet
          open
          state={{
            status: "ready",
            payload: {
              hunks: [sampleHunk],
              summary: "tightened",
            },
            cost: { tokens_in: 100, tokens_out: 30, cost_krw: 0 },
          }}
          onAcceptAll={vi.fn()}
          onRejectAll={vi.fn()}
          onClose={vi.fn()}
        />,
      ),
    );
    expect(screen.getByText("tightened")).toBeInTheDocument();
    expect(screen.getByText("hello")).toBeInTheDocument();
    expect(screen.getByText("Hi")).toBeInTheDocument();
  });

  it("invokes onAcceptAll when the accept button is clicked", () => {
    const onAcceptAll = vi.fn();
    render(
      withIntl(
        <InlineDiffSheet
          open
          state={{
            status: "ready",
            payload: { hunks: [sampleHunk], summary: "tightened" },
            cost: { tokens_in: 0, tokens_out: 0, cost_krw: 0 },
          }}
          onAcceptAll={onAcceptAll}
          onRejectAll={vi.fn()}
          onClose={vi.fn()}
        />,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: /accept all/i }));
    expect(onAcceptAll).toHaveBeenCalledTimes(1);
  });

  it("invokes onRejectAll when the reject button is clicked", () => {
    const onRejectAll = vi.fn();
    render(
      withIntl(
        <InlineDiffSheet
          open
          state={{
            status: "ready",
            payload: { hunks: [sampleHunk], summary: "tightened" },
            cost: { tokens_in: 0, tokens_out: 0, cost_krw: 0 },
          }}
          onAcceptAll={vi.fn()}
          onRejectAll={onRejectAll}
          onClose={vi.fn()}
        />,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: /reject all/i }));
    expect(onRejectAll).toHaveBeenCalledTimes(1);
  });

  it("renders the localized error message for known error codes", () => {
    render(
      withIntl(
        <InlineDiffSheet
          open
          state={{
            status: "error",
            code: "llm_failed",
            message: "raw worker message",
          }}
          onAcceptAll={vi.fn()}
          onRejectAll={vi.fn()}
          onClose={vi.fn()}
        />,
      ),
    );
    expect(screen.getByText(/AI call failed/i)).toBeInTheDocument();
  });

  it("renders loading copy while running", () => {
    render(
      withIntl(
        <InlineDiffSheet
          open
          state={{ status: "running" }}
          onAcceptAll={vi.fn()}
          onRejectAll={vi.fn()}
          onClose={vi.fn()}
        />,
      ),
    );
    expect(screen.getByText(/Working/i)).toBeInTheDocument();
  });

  it("renders the translate language picker for /translate before result", () => {
    const onLanguageChange = vi.fn();
    render(
      withIntl(
        <InlineDiffSheet
          open
          state={{ status: "running" }}
          currentCommand="translate"
          currentLanguage="en"
          onLanguageChange={onLanguageChange}
          onAcceptAll={vi.fn()}
          onRejectAll={vi.fn()}
          onClose={vi.fn()}
        />,
      ),
    );
    const picker = screen.getByTestId("translate-language-picker");
    expect(picker).toBeInTheDocument();
    expect((picker as HTMLSelectElement).value).toBe("en");
    fireEvent.change(picker, { target: { value: "ja" } });
    expect(onLanguageChange).toHaveBeenCalledWith("ja");
  });

  it("hides the language picker for non-translate commands", () => {
    render(
      withIntl(
        <InlineDiffSheet
          open
          state={{ status: "running" }}
          currentCommand="improve"
          onLanguageChange={vi.fn()}
          onAcceptAll={vi.fn()}
          onRejectAll={vi.fn()}
          onClose={vi.fn()}
        />,
      ),
    );
    expect(
      screen.queryByTestId("translate-language-picker"),
    ).not.toBeInTheDocument();
  });

  it("hides the language picker once a translate result is ready", () => {
    render(
      withIntl(
        <InlineDiffSheet
          open
          state={{
            status: "ready",
            payload: { hunks: [sampleHunk], summary: "translated" },
            cost: { tokens_in: 0, tokens_out: 0, cost_krw: 0 },
          }}
          currentCommand="translate"
          currentLanguage="en"
          onLanguageChange={vi.fn()}
          onAcceptAll={vi.fn()}
          onRejectAll={vi.fn()}
          onClose={vi.fn()}
        />,
      ),
    );
    expect(
      screen.queryByTestId("translate-language-picker"),
    ).not.toBeInTheDocument();
  });
});
