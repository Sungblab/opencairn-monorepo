import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

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
});
