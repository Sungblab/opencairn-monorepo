import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ChipRow } from "./ChipRow";

vi.mock("next-intl", () => ({
  useTranslations: (ns?: string) => (k: string, vars?: Record<string, unknown>) =>
    vars
      ? `${ns ? `${ns}.` : ""}${k}(${JSON.stringify(vars)})`
      : ns
        ? `${ns}.${k}`
        : k,
}));

describe("<ChipRow>", () => {
  it("renders one chip per attached item", () => {
    render(
      <ChipRow
        chips={[
          { type: "page", id: "p1", label: "RoPE", manual: false },
          { type: "project", id: "pr1", label: "Thesis", manual: true },
        ]}
        workspaceId="ws-1"
        onRemove={() => {}}
        onAdd={() => {}}
      />,
    );
    expect(screen.getByText("RoPE")).toBeInTheDocument();
    expect(screen.getByText("Thesis")).toBeInTheDocument();
  });

  it("calls onRemove with composite key when X clicked", () => {
    const onRemove = vi.fn();
    render(
      <ChipRow
        chips={[{ type: "page", id: "p1", label: "RoPE", manual: false }]}
        workspaceId="ws-1"
        onRemove={onRemove}
        onAdd={() => {}}
      />,
    );
    // The aria label is rendered through useTranslations, which emits
    // `chatScope.chip.remove_aria({"label":"RoPE"})` under the test mock.
    fireEvent.click(
      screen.getByRole("button", {
        name: /remove_aria.*RoPE/i,
      }),
    );
    expect(onRemove).toHaveBeenCalledWith("page:p1");
  });

  it("renders the + add-context button via combobox", () => {
    render(
      <ChipRow
        chips={[]}
        workspaceId="ws-1"
        onRemove={() => {}}
        onAdd={() => {}}
      />,
    );
    expect(
      screen.getByRole("button", { name: /add_aria/i }),
    ).toBeInTheDocument();
  });
});
