import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import koMessages from "@/../messages/ko/editor.json";
import { MermaidElement } from "./mermaid-element";
import { ThemeProvider } from "@/lib/theme/provider";

vi.mock("@/hooks/useMermaidRender", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useMermaidRender")>(
    "@/hooks/useMermaidRender",
  );
  return {
    ...actual,
    useMermaidRender: (code: string) => ({
      svg: code === "BAD" ? null : `<svg data-testid="rendered-svg">${code}</svg>`,
      error: code === "BAD" ? new Error("parse fail") : null,
      loading: false,
    }),
  };
});

const wrap = (ui: React.ReactNode) => (
  <NextIntlClientProvider locale="ko" messages={{ editor: koMessages }}>
    <ThemeProvider initialTheme="cairn-light">{ui}</ThemeProvider>
  </NextIntlClientProvider>
);

describe("MermaidElement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders SVG when code parses", async () => {
    render(
      wrap(
        // @ts-expect-error — test mock omits Plate's full editor context
        <MermaidElement
          attributes={{ "data-slate-node": "element" } as never}
          element={{ type: "mermaid", code: "graph TD\nA --> B", children: [{ text: "" }] }}
        >
          <span />
        </MermaidElement>,
      ),
    );
    await waitFor(() => {
      expect(screen.getByTestId("rendered-svg")).toBeInTheDocument();
    });
  });

  it("renders error UI when parse fails", () => {
    render(
      wrap(
        // @ts-expect-error — test mock omits Plate's full editor context
        <MermaidElement
          attributes={{ "data-slate-node": "element" } as never}
          element={{ type: "mermaid", code: "BAD", children: [{ text: "" }] }}
        >
          <span />
        </MermaidElement>,
      ),
    );
    expect(screen.getByText(/다이어그램 오류/)).toBeInTheDocument();
  });
});
