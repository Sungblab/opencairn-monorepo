import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { GraphFilters } from "../GraphFilters";
import koGraph from "@/../messages/ko/graph.json";

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="ko" messages={{ graph: koGraph }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("GraphFilters", () => {
  it("calls onChange on search input", () => {
    const onChange = vi.fn();
    renderWithIntl(
      <GraphFilters
        filters={{ search: "", relation: null }}
        relations={["is-a"]}
        truncated={false}
        shown={0}
        total={0}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText(koGraph.filters.searchPlaceholder), {
      target: { value: "x" },
    });
    expect(onChange).toHaveBeenCalledWith({ search: "x" });
  });

  it("renders the truncated banner", () => {
    renderWithIntl(
      <GraphFilters
        filters={{ search: "", relation: null }}
        relations={[]}
        truncated={true}
        shown={500}
        total={847}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText(/500/)).toBeInTheDocument();
    expect(screen.getByText(/847/)).toBeInTheDocument();
  });
});
