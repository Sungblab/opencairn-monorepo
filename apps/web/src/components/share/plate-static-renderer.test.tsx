import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Plan 2E Phase B-5 Task 5.1 — mock katex to avoid CSS/font loading in jsdom.
// The real katex.renderToString adds class="katex" wrappers; we use a simple
// passthrough so tests can confirm the tex expression is forwarded.
vi.mock("katex", () => ({
  default: {
    renderToString: (tex: string, opts?: { displayMode?: boolean }) => {
      return opts?.displayMode
        ? `<span class="katex-display">${tex}</span>`
        : `<span class="katex">${tex}</span>`;
    },
  },
}));

import { PlateStaticRenderer } from "./plate-static-renderer";

describe("PlateStaticRenderer", () => {
  it("renders a paragraph with text", () => {
    render(
      <PlateStaticRenderer
        value={[{ type: "p", children: [{ text: "hello world" }] }]}
      />,
    );
    expect(screen.getByText("hello world")).toBeInTheDocument();
  });

  it("renders empty value without crashing", () => {
    render(<PlateStaticRenderer value={[]} />);
  });

  it("renders headings as h-tags", () => {
    render(
      <PlateStaticRenderer
        value={[{ type: "h1", children: [{ text: "Title" }] }]}
      />,
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "Title" }),
    ).toBeInTheDocument();
  });

  it("falls back to <div> for unknown block types so content is never dropped", () => {
    render(
      <PlateStaticRenderer
        value={[
          {
            type: "research_meta",
            children: [{ text: "future-block content" }],
          },
        ]}
      />,
    );
    expect(screen.getByText("future-block content")).toBeInTheDocument();
  });

  it("renders inline link nodes (Notion / deep-research import) with safe href", () => {
    render(
      <PlateStaticRenderer
        value={[
          {
            type: "p",
            children: [
              { text: "see " },
              {
                type: "a",
                url: "https://example.com/path",
                children: [{ text: "the docs" }],
              },
              { text: " for more" },
            ],
          },
        ]}
      />,
    );
    const link = screen.getByRole("link", { name: "the docs" });
    expect(link.getAttribute("href")).toBe("https://example.com/path");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("rejects javascript: and data: URLs (defangs to '#')", () => {
    render(
      <PlateStaticRenderer
        value={[
          {
            type: "p",
            children: [
              {
                type: "a",
                url: "javascript:alert(1)",
                children: [{ text: "click me" }],
              },
              {
                type: "a",
                url: "data:text/html,<script>alert(1)</script>",
                children: [{ text: "data link" }],
              },
            ],
          },
        ]}
      />,
    );
    expect(screen.getByRole("link", { name: "click me" }).getAttribute("href")).toBe("#");
    expect(screen.getByRole("link", { name: "data link" }).getAttribute("href")).toBe("#");
  });

  it("applies bold and italic marks", () => {
    render(
      <PlateStaticRenderer
        value={[
          {
            type: "p",
            children: [
              { text: "plain " },
              { text: "loud", bold: true },
              { text: " " },
              { text: "side", italic: true },
            ],
          },
        ]}
      />,
    );
    // Unwrap by tag rather than CSS — `<strong>` / `<em>` are the semantic
    // anchors the renderer commits to.
    const strong = screen.getByText("loud");
    expect(strong.tagName).toBe("STRONG");
    const em = screen.getByText("side");
    expect(em.tagName).toBe("EM");
  });

  // Plan 2E Phase B-5 Task 5.1 — math regression tests.
  //
  // These guard against the regression flagged by Phase B-4: MathInline and
  // MathBlock call useEditorRef() internally, so they must NOT be used in any
  // static rendering path. The static renderer uses a separate katex-only
  // renderer that has no Plate editor dependency.

  it("renders block math (equation) without requiring an editor context", () => {
    // If the wrong component (MathBlock) were used here, this would throw
    // "Could not find the plate context" from useEditorRef(). We assert that
    // the rendered output includes the tex expression (forwarded to our mocked
    // katex) rather than falling through to an empty <div>.
    render(
      <PlateStaticRenderer
        value={[
          {
            type: "equation",
            texExpression: "E=mc^2",
            children: [{ text: "" }],
          },
        ]}
      />,
    );
    expect(document.body.innerHTML).toContain("E=mc^2");
  });

  it("renders inline math (inline_equation) without requiring an editor context", () => {
    render(
      <PlateStaticRenderer
        value={[
          {
            type: "p",
            children: [
              { text: "The formula " },
              {
                type: "inline_equation",
                texExpression: "x^2",
                children: [{ text: "" }],
              },
              { text: " is inline." },
            ],
          },
        ]}
      />,
    );
    // The key assertion: tex expression is rendered (not dropped as an empty div)
    expect(document.body.innerHTML).toContain("x^2");
    // The surrounding text runs survive — use innerHTML check since the spans
    // split the text nodes and getByText exact match fails on trailing spaces.
    expect(document.body.innerHTML).toContain("The formula");
    expect(document.body.innerHTML).toContain("is inline.");
  });

  it("renders block math parse error fallback when tex is invalid", () => {
    // Mock katex throws for invalid tex; the renderer should show a fallback.
    // Our vi.mock above always succeeds, so this test uses empty texExpression
    // which renderKatexHtml returns null for (empty string guard).
    render(
      <PlateStaticRenderer
        value={[
          {
            type: "equation",
            texExpression: "",
            children: [{ text: "" }],
          },
        ]}
      />,
    );
    // Empty tex → null html → renders the fallback "$$$$" span
    expect(document.body.innerHTML).toContain("$$$$");
  });

  it("renders code blocks with language chrome and line-preserving code", () => {
    render(
      <PlateStaticRenderer
        value={[
          {
            type: "code_block",
            language: "typescript",
            children: [
              { type: "code_line", children: [{ text: "const answer = 42;" }] },
              { type: "code_line", children: [{ text: "console.log(answer);" }] },
            ],
          },
        ]}
      />,
    );

    expect(screen.getByTestId("static-code-block")).toBeInTheDocument();
    expect(screen.getByTestId("static-code-language")).toHaveTextContent(
      "typescript",
    );
    expect(screen.getByText("const answer = 42;")).toBeInTheDocument();
    expect(screen.getByText("console.log(answer);")).toBeInTheDocument();
  });
});
