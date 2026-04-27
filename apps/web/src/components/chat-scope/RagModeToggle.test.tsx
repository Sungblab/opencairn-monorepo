import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RagModeToggle } from "./RagModeToggle";

vi.mock("next-intl", () => ({
  useTranslations: (ns?: string) => (k: string) => (ns ? `${ns}.${k}` : k),
}));

describe("<RagModeToggle>", () => {
  it("renders the current mode label", () => {
    render(<RagModeToggle mode="strict" onChange={() => {}} />);
    expect(screen.getByText(/strict_label/i)).toBeInTheDocument();
  });

  it("calls onChange when expand option clicked", () => {
    const onChange = vi.fn();
    render(<RagModeToggle mode="strict" onChange={onChange} />);
    // Click trigger to open the menu, then click the expand description.
    fireEvent.click(screen.getAllByRole("button")[0]);
    fireEvent.click(screen.getByText(/expand_description/i));
    expect(onChange).toHaveBeenCalledWith("expand");
  });

  it("renders both strict + expand options when open", () => {
    render(<RagModeToggle mode="strict" onChange={() => {}} />);
    fireEvent.click(screen.getAllByRole("button")[0]);
    expect(screen.getByText(/strict_description/i)).toBeInTheDocument();
    expect(screen.getByText(/expand_description/i)).toBeInTheDocument();
  });
});
