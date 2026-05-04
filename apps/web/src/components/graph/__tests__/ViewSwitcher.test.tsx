import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { ViewSwitcher } from "../ViewSwitcher";
import koGraph from "@/../messages/ko/graph.json";

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
  useSearchParams: vi.fn(),
}));

function renderWithIntl(ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="ko" messages={{ graph: koGraph }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("ViewSwitcher", () => {
  let replace: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    replace = vi.fn();
    (useRouter as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ replace });
    (useSearchParams as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      new URLSearchParams(),
    );
  });

  it("renders 5 view buttons + AI trigger", () => {
    renderWithIntl(<ViewSwitcher onAiClick={() => {}} />);
    for (const v of ["graph", "mindmap", "cards", "timeline", "board"]) {
      expect(screen.getByRole("button", {
        name: koGraph.views[v as keyof typeof koGraph.views],
      })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", {
      name: new RegExp(koGraph.ai.trigger),
    })).toHaveClass("min-h-7");
  });

  it("clicking a view replaces ?view= and preserves other params", () => {
    (useSearchParams as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      new URLSearchParams("relation=uses&view=graph"),
    );
    renderWithIntl(<ViewSwitcher onAiClick={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: koGraph.views.cards }));
    expect(replace).toHaveBeenCalledWith(
      expect.stringContaining("view=cards"),
      expect.objectContaining({ scroll: false }),
    );
    const url = replace.mock.calls[0][0] as string;
    expect(url).toContain("relation=uses");
  });

  it("switching to non-mindmap/board drops ?root", () => {
    (useSearchParams as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      new URLSearchParams("view=mindmap&root=abc"),
    );
    renderWithIntl(<ViewSwitcher onAiClick={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: koGraph.views.cards }));
    const url = replace.mock.calls[0][0] as string;
    expect(url).not.toContain("root=");
  });

  it("AI trigger calls onAiClick", () => {
    const onAi = vi.fn();
    renderWithIntl(<ViewSwitcher onAiClick={onAi} />);
    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(koGraph.ai.trigger) }),
    );
    expect(onAi).toHaveBeenCalledTimes(1);
  });
});
