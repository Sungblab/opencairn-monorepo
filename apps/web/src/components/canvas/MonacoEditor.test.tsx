import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MonacoEditor } from "./MonacoEditor";

// Mock @monaco-editor/react to avoid loading actual Monaco in jsdom (heavy
// worker setup, no canvas in jsdom). The mock proxies the language/value/
// onChange surface as a textarea so we can assert mapping + value flow.
vi.mock("@monaco-editor/react", () => ({
  default: ({
    language,
    value,
    onChange,
  }: {
    language: string;
    value: string;
    onChange?: (v: string | undefined) => void;
  }) => (
    <div data-testid="monaco" data-lang={language}>
      <textarea
        data-testid="monaco-input"
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        readOnly
      />
      {value}
    </div>
  ),
}));

// Mock next-intl + the project's theme provider so the wrapper renders
// without needing real providers in test.
vi.mock("next-intl", () => ({
  useTranslations: () => (k: string) => k,
}));
vi.mock("@/lib/theme/provider", () => ({
  useTheme: () => ({ theme: "cairn-light" }),
}));

describe("MonacoEditor", () => {
  it("maps canvasLanguage='react' → monaco language='javascript'", async () => {
    render(<MonacoEditor language="react" value="<div/>" onChange={() => {}} />);
    await waitFor(() => {
      expect(screen.getByTestId("monaco")).toHaveAttribute(
        "data-lang",
        "javascript",
      );
    });
  });

  it("renders source value", async () => {
    render(
      <MonacoEditor language="python" value="print(1)" onChange={() => {}} />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("monaco")).toHaveTextContent("print(1)");
    });
  });

  it("maps html and javascript correctly", async () => {
    const { rerender } = render(
      <MonacoEditor language="html" value="<p>hi</p>" onChange={() => {}} />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("monaco")).toHaveAttribute("data-lang", "html");
    });
    rerender(
      <MonacoEditor language="javascript" value="x=1" onChange={() => {}} />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("monaco")).toHaveAttribute(
        "data-lang",
        "javascript",
      );
    });
  });
});
